import { jest } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const mockInfo = jest.fn();
const mockSetFailed = jest.fn();
const mockWarning = jest.fn();
const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();
const mockPost = jest.fn();
const mockHttpClient = jest.fn();
const mockGetIDToken = jest.fn();
const mockSetSecret = jest.fn();
const originalGitHubWorkspace = process.env.GITHUB_WORKSPACE;

function decodeCoverageContent(encoded) {
  return gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
}

jest.unstable_mockModule('@actions/core', () => ({
  info: mockInfo,
  setFailed: mockSetFailed,
  warning: mockWarning,
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
  getIDToken: mockGetIDToken,
  setSecret: mockSetSecret,
}));

jest.unstable_mockModule('@actions/http-client', () => ({
  HttpClient: mockHttpClient,
  HttpCodes: {
    OK: 200,
  },
}));

const { run } = await import('../src/main.js');

function mockResponse(statusCode, rawBody = '') {
  return {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(rawBody),
  };
}

async function seedRepo(tmpDir, sourceFiles = { 'src/test.js': 'a\nb\nc\n' }) {
  await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
  for (const [rel, content] of Object.entries(sourceFiles)) {
    await fs.mkdir(path.join(tmpDir, path.dirname(rel)), { recursive: true });
    await fs.writeFile(path.join(tmpDir, rel), content);
  }
}

describe('main.js', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'main-test-'));

    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.GITHUB_SHA = 'abc123';
    process.env.GITHUB_HEAD_REF = 'main';
    process.env.GITHUB_WORKSPACE = tmpDir;
    delete process.env.DEVELOPMENT;

    mockInfo.mockClear();
    mockSetFailed.mockClear();
    mockWarning.mockClear();
    mockGetInput.mockClear();
    mockGetBooleanInput.mockClear();
    mockPost.mockClear();
    mockHttpClient.mockClear();
    mockGetIDToken.mockClear();
    mockSetSecret.mockClear();

    mockGetInput.mockImplementation((name) => {
      if (name === 'region') {
        return 'eu';
      }
      return '';
    });
    mockGetBooleanInput.mockImplementation((name) => name === 'fail-on-error');
    mockHttpClient.mockImplementation(() => ({
      post: mockPost,
    }));
    mockPost.mockResolvedValue(mockResponse(200, JSON.stringify({ success: true })));
    mockGetIDToken.mockResolvedValue('oidc-jwt');
  });

  function setCoverageInput(filePaths) {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return filePaths;
      }
      if (name === 'region') {
        return 'eu';
      }
      return '';
    });
  }

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalGitHubWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE;
    } else {
      process.env.GITHUB_WORKSPACE = originalGitHubWorkspace;
    }
  });

  describe('path traversal protection', () => {
    it('rejects path with .. segment', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        setCoverageInput('../../../etc/passwd');
        await run();
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(
            'Invalid file path: absolute paths and ".." segments are not allowed',
          ),
        );
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('rejects absolute path', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        setCoverageInput('/var/log/system.log');
        await run();
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(
            'Invalid file path: absolute paths and ".." segments are not allowed',
          ),
        );
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('successful upload', () => {
    it('uploads raw file with repository_source_paths and eof', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await seedRepo(tmpDir);
        const lcovContent = 'TN:\nSF:src/test.js\nDA:1,5\nend_of_record\n';
        await fs.writeFile('lcov.info', lcovContent);
        setCoverageInput('lcov.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        expect(mockPost).toHaveBeenCalledTimes(1);
        const [url, rawBody, headers] = mockPost.mock.calls[0];
        expect(url).toBe(
          'https://bg.aikido.dev/api/integrations/continuous_integration/scan/code_coverage',
        );

        const body = JSON.parse(rawBody);
        expect(body.repository_source_paths).toContain('src/test.js');
        expect(body.eof['src/test.js']).toBeGreaterThan(0);
        expect(body.files).toHaveLength(1);
        expect(body.files[0].format).toBe('lcov');
        expect(decodeCoverageContent(body.files[0].content)).toBe(lcovContent);
        expect(body.code_coverage_file_content).toBeUndefined();
        expect(headers['Content-Type']).toBe('application/json');
        expect(mockInfo).toHaveBeenCalledWith('Upload succeeded.');
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('uploads multiple files without merging', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await seedRepo(tmpDir, {
          'src/a.js': 'a\n',
          'src/b.js': 'b\n',
        });
        const lcov1 = 'TN:\nSF:src/a.js\nDA:1,5\nend_of_record\n';
        const lcov2 = 'TN:\nSF:src/b.js\nDA:1,3\nend_of_record\n';
        await fs.writeFile('lcov1.info', lcov1);
        await fs.writeFile('lcov2.info', lcov2);
        setCoverageInput('lcov1.info lcov2.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        const [, rawBody] = mockPost.mock.calls[0];
        const body = JSON.parse(rawBody);
        expect(body.files).toHaveLength(2);
        expect(decodeCoverageContent(body.files[0].content)).toBe(lcov1);
        expect(decodeCoverageContent(body.files[1].content)).toBe(lcov2);
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('uploads cobertura with detected format', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await seedRepo(tmpDir, { 'src/a.js': 'a\n' });
        const xml = `<?xml version="1.0" ?>
<coverage>
  <packages><package name=""><classes>
    <class name="a" filename="src/a.js">
      <lines><line number="1" hits="1" branch="false"/></lines>
    </class>
  </classes></package></packages>
</coverage>
`;
        await fs.writeFile('cobertura.xml', xml);
        setCoverageInput('cobertura.xml');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        const [, rawBody] = mockPost.mock.calls[0];
        const body = JSON.parse(rawBody);
        expect(body.files[0].format).toBe('cobertura');
        expect(decodeCoverageContent(body.files[0].content)).toContain('filename="src/a.js"');
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('multi-file path validation', () => {
    it('rejects path traversal among multiple paths', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await seedRepo(tmpDir, { 'src/a.js': 'a\n' });
        await fs.writeFile('lcov1.info', 'TN:\nSF:src/a.js\nDA:1,5\nend_of_record\n');
        setCoverageInput('lcov1.info ../../../etc/passwd');

        await run();

        expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid file path'));
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('fail-on-error behavior', () => {
    it('uses warning instead of setFailed when fail-on-error is false', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        mockGetBooleanInput.mockReturnValue(false);
        setCoverageInput('../../../etc/passwd');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        expect(mockWarning).toHaveBeenCalledWith(
          expect.stringContaining('Coverage upload skipped: Invalid file path'),
        );
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  it('rejects when format cannot be detected from the filename', async () => {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      await seedRepo(tmpDir);
      await fs.writeFile('report.txt', 'not coverage');
      setCoverageInput('report.txt');

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('Could not detect coverage format'),
      );
      expect(mockPost).not.toHaveBeenCalled();
    } finally {
      process.chdir(previousCwd);
    }
  });
});
