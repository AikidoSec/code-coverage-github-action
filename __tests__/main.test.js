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

describe('main.js security - single file path validation', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'main-test-'));

    // Set up environment variables
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.GITHUB_SHA = 'abc123';
    process.env.GITHUB_HEAD_REF = 'main';
    process.env.GITHUB_WORKSPACE = tmpDir;
    delete process.env.DEVELOPMENT;

    // Reset all mocks
    mockInfo.mockClear();
    mockSetFailed.mockClear();
    mockWarning.mockClear();
    mockGetInput.mockClear();
    mockGetBooleanInput.mockClear();
    mockPost.mockClear();
    mockHttpClient.mockClear();
    mockGetIDToken.mockClear();
    mockSetSecret.mockClear();

    // Default mock implementations
    mockGetInput.mockImplementation((name) => {
      if (name === 'region') {
        return 'eu';
      }
      return '';
    });
    mockGetBooleanInput.mockImplementation((name) => {
      if (name === 'fail-on-error') {
        return true;
      }
      return false;
    });
    mockHttpClient.mockImplementation(() => ({
      post: mockPost,
    }));
    mockPost.mockResolvedValue(mockResponse(200, JSON.stringify({ success: true })));
    mockGetIDToken.mockResolvedValue('oidc-jwt');
  });

  function setCoverageInput(filePaths, format = 'lcov') {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return filePaths;
      }
      if (name === 'format') {
        return format;
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
    it('rejects single file path with .. segment', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Create a legitimate coverage file
        await fs.writeFile('lcov.info', 'TN:\nSF:test.js\nend_of_record\n');

        // Attempt to use path traversal
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

    it('rejects single file path with multiple .. segments', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        setCoverageInput('../../sensitive/file.txt');

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

    it('rejects single file path with .. in the middle', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        setCoverageInput('coverage/../../../etc/passwd');

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

  describe('absolute path protection', () => {
    it('rejects single file path with absolute Unix path', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        setCoverageInput('/etc/passwd');

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

    it('rejects single file path with absolute Windows path', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Windows absolute path - only test on Windows
        if (process.platform === 'win32') {
          setCoverageInput('C:\\Windows\\System32\\config\\SAM');

          await run();

          expect(mockSetFailed).toHaveBeenCalledWith(
            expect.stringContaining(
              'Invalid file path: absolute paths and ".." segments are not allowed',
            ),
          );
          expect(mockPost).not.toHaveBeenCalled();
        } else {
          // On Unix, test with a Unix absolute path instead
          setCoverageInput('/var/log/system.log');

          await run();

          expect(mockSetFailed).toHaveBeenCalledWith(
            expect.stringContaining(
              'Invalid file path: absolute paths and ".." segments are not allowed',
            ),
          );
          expect(mockPost).not.toHaveBeenCalled();
        }
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('coverage file discovery logging', () => {
    it('logs found coverage file paths for a single file', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.writeFile('lcov.info', 'TN:\nSF:src/test.js\nDA:1,5\nend_of_record\n');
        setCoverageInput('lcov.info');

        await run();

        expect(mockInfo).toHaveBeenCalledWith('Found 1 coverage file(s) at path(s) \n\tlcov.info');
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('logs found coverage file paths for multiple files', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.writeFile('lcov1.info', 'TN:\nSF:src/a.js\nDA:1,5\nend_of_record\n');
        await fs.writeFile('lcov2.info', 'TN:\nSF:src/b.js\nDA:1,3\nend_of_record\n');
        setCoverageInput('lcov1.info lcov2.info');

        await run();

        expect(mockInfo).toHaveBeenCalledWith(
          'Found 2 coverage file(s) at path(s) \n\tlcov1.info\n\tlcov2.info',
        );
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('valid single file path', () => {
    it('accepts and processes valid relative single file path', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        const lcovContent = 'TN:\nSF:src/test.js\nDA:1,5\nend_of_record\n';
        await fs.writeFile('lcov.info', lcovContent);

        setCoverageInput('lcov.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();

        // Verify the POST was called with the correct content
        expect(mockPost).toHaveBeenCalledTimes(1);
        const [url, rawBody, headers] = mockPost.mock.calls[0];
        expect(url).toBe(
          'https://bg.aikido.dev/api/integrations/continuous_integration/scan/code_coverage',
        );

        const body = JSON.parse(rawBody);
        expect(decodeCoverageContent(body.code_coverage_file_content)).toBe(lcovContent);
        expect(body.format).toBe('lcov');
        expect(body.repo_name).toBe('org/repo');
        expect(body.commit_sha).toBe('abc123');
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Content-Encoding']).toBeUndefined();

        expect(mockInfo).not.toHaveBeenCalledWith(
          `Uploading coverage report for branch haha to Aikido...`,
        );
        expect(mockInfo).toHaveBeenCalledWith(
          `Uploading coverage report for branch main to Aikido...`,
        );
        expect(mockInfo).toHaveBeenCalledWith('Upload succeeded.');
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('accepts valid relative path in subdirectory', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.mkdir('coverage', { recursive: true });
        const lcovContent = 'TN:\nSF:src/app.js\nDA:1,10\nend_of_record\n';
        await fs.writeFile('coverage/lcov.info', lcovContent);

        setCoverageInput('coverage/lcov.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();

        // Verify the POST was called with the correct content
        expect(mockPost).toHaveBeenCalledTimes(1);
        const [url, rawBody] = mockPost.mock.calls[0];
        expect(url).toBe(
          'https://bg.aikido.dev/api/integrations/continuous_integration/scan/code_coverage',
        );

        const body = JSON.parse(rawBody);
        expect(decodeCoverageContent(body.code_coverage_file_content)).toBe(lcovContent);
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('uploads absolute source paths relative to the checkout root', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        const absoluteSourcePath = path.join(tmpDir, 'src/app.js');
        await fs.writeFile('lcov.info', `TN:\nSF:${absoluteSourcePath}\nDA:1,10\nend_of_record\n`);
        setCoverageInput('lcov.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        const [, rawBody] = mockPost.mock.calls[0];
        const body = JSON.parse(rawBody);
        const uploaded = decodeCoverageContent(body.code_coverage_file_content);
        expect(uploaded).toContain('SF:src/app.js');
        expect(uploaded).not.toContain(tmpDir);
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('normalizes Windows source paths without merging the single input', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        process.env.GITHUB_WORKSPACE = 'D:\\a\\repo\\repo';
        const lcovContent = 'TN:\nSF:D:\\a\\repo\\repo\\src\\app.cs\nDA:1,10\nend_of_record\n';
        await fs.writeFile('lcov.info', lcovContent);
        setCoverageInput('lcov.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        const [, rawBody] = mockPost.mock.calls[0];
        const body = JSON.parse(rawBody);
        const uploaded = decodeCoverageContent(body.code_coverage_file_content);
        expect(uploaded).toBe('TN:\nSF:src/app.cs\nDA:1,10\nend_of_record\n');
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('multi-file path validation (existing behavior)', () => {
    it('validates multiple file paths through mergeLcov', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        const lcov1 = 'TN:\nSF:src/a.js\nDA:1,5\nend_of_record\n';
        const lcov2 = 'TN:\nSF:src/b.js\nDA:1,3\nend_of_record\n';

        await fs.writeFile('lcov1.info', lcov1);
        await fs.writeFile('lcov2.info', lcov2);

        setCoverageInput('lcov1.info lcov2.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        expect(mockPost).toHaveBeenCalled();
        expect(mockInfo).toHaveBeenCalledWith('Upload succeeded.');
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('rejects path traversal in multi-file scenario', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.writeFile('lcov1.info', 'TN:\nSF:src/a.js\nDA:1,5\nend_of_record\n');

        // One valid path, one with traversal
        setCoverageInput('lcov1.info ../../../etc/passwd');

        await run();

        expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid file path'));
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('rejects absolute path in multi-file scenario', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.writeFile('lcov1.info', 'TN:\nSF:src/a.js\nDA:1,5\nend_of_record\n');

        // One valid path, one absolute
        setCoverageInput('lcov1.info /etc/passwd');

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
        mockGetBooleanInput.mockImplementation((name) => {
          if (name === 'fail-on-error') {
            return false;
          }
          return false;
        });
        setCoverageInput('../../../etc/passwd');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        expect(mockWarning).toHaveBeenCalledWith(
          expect.stringContaining(
            'Coverage upload skipped: Invalid file path: absolute paths and ".." segments are not allowed',
          ),
        );
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('exploit scenario prevention', () => {
    it('prevents exfiltration of /etc/passwd via single path', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Simulate attacker trying to read /etc/passwd
        setCoverageInput('/etc/passwd');

        await run();

        // Verify the attack was blocked
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(
            'Invalid file path: absolute paths and ".." segments are not allowed',
          ),
        );

        // Verify no data was uploaded
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('prevents exfiltration of GitHub secrets via path traversal', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Simulate attacker trying to read runner secrets or environment files
        setCoverageInput('../../.env');

        await run();

        // Verify the attack was blocked
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(
            'Invalid file path: absolute paths and ".." segments are not allowed',
          ),
        );

        // Verify no data was uploaded
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('prevents reading arbitrary runner files via complex traversal', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Complex path traversal attempt
        setCoverageInput('coverage/../../../../../../home/runner/.ssh/id_rsa');

        await run();

        // Verify the attack was blocked
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(
            'Invalid file path: absolute paths and ".." segments are not allowed',
          ),
        );

        // Verify no data was uploaded
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('validation happens before file read', () => {
    it('validates path before attempting to read file', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Use a path that would fail validation
        setCoverageInput('../sensitive.txt');

        await run();

        // Should fail with validation error, not file not found error
        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining(
            'Invalid file path: absolute paths and ".." segments are not allowed',
          ),
        );

        // Should not attempt to read the file
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('cobertura support', () => {
    it('uploads a single cobertura file with format cobertura', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        const xml = `<?xml version="1.0" ?>
<coverage line-rate="1" branch-rate="1">
  <sources><source>.</source></sources>
  <packages>
    <package name="">
      <classes>
        <class name="a" filename="src/a.js">
          <lines>
            <line number="1" hits="1" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;
        await fs.writeFile('cobertura.xml', xml);
        setCoverageInput('cobertura.xml', 'cobertura');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        expect(mockPost).toHaveBeenCalledTimes(1);
        const [, rawBody] = mockPost.mock.calls[0];
        const body = JSON.parse(rawBody);
        expect(body.format).toBe('cobertura');
        const uploaded = decodeCoverageContent(body.code_coverage_file_content);
        expect(uploaded).toContain('filename="src/a.js"');
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('merges multiple cobertura files before upload', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.mkdir('job1', { recursive: true });
        await fs.mkdir('job2', { recursive: true });
        await fs.writeFile(
          'job1/cobertura.xml',
          `<?xml version="1.0" ?>
<coverage>
  <sources><source>.</source></sources>
  <packages><package name=""><classes>
    <class name="a" filename="src/a.js">
      <lines><line number="1" hits="1" branch="false"/></lines>
    </class>
  </classes></package></packages>
</coverage>
`,
        );
        await fs.writeFile(
          'job2/cobertura.xml',
          `<?xml version="1.0" ?>
<coverage>
  <sources><source>.</source></sources>
  <packages><package name=""><classes>
    <class name="a" filename="src/a.js">
      <lines><line number="1" hits="3" branch="false"/></lines>
    </class>
  </classes></package></packages>
</coverage>
`,
        );
        setCoverageInput('job1/cobertura.xml job2/cobertura.xml', 'cobertura');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        const [, rawBody] = mockPost.mock.calls[0];
        const body = JSON.parse(rawBody);
        expect(body.format).toBe('cobertura');
        const uploaded = decodeCoverageContent(body.code_coverage_file_content);
        expect(uploaded).toMatch(/number="1"[^>]*hits="3"/);
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('rejects when format is invalid', async () => {
      mockGetInput.mockImplementation((name) => {
        if (name === 'file-paths') {
          return 'lcov.info';
        }
        if (name === 'format') {
          return 'jacoco';
        }
        if (name === 'region') {
          return 'eu';
        }
        return '';
      });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid format'));
      expect(mockPost).not.toHaveBeenCalled();
    });
  });
});
