import { jest } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const mockInfo = jest.fn();
const mockDebug = jest.fn();
const mockSetFailed = jest.fn();
const mockWarning = jest.fn();
const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();
const mockPost = jest.fn();
const mockHttpClient = jest.fn();
const mockGetIDToken = jest.fn();
const mockSetSecret = jest.fn();

function decodeCoverageContent(encoded) {
  return gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
}

jest.unstable_mockModule('@actions/core', () => ({
  info: mockInfo,
  debug: mockDebug,
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
    delete process.env.DEVELOPMENT;

    // Reset all mocks
    mockInfo.mockClear();
    mockDebug.mockClear();
    mockSetFailed.mockClear();
    mockWarning.mockClear();
    mockGetInput.mockClear();
    mockGetBooleanInput.mockClear();
    mockPost.mockClear();
    mockHttpClient.mockClear();
    mockGetIDToken.mockClear();
    mockSetSecret.mockClear();

    // Default mock implementations
    mockGetBooleanInput.mockReturnValue(true);
    mockHttpClient.mockImplementation(() => ({
      post: mockPost,
    }));
    mockPost.mockResolvedValue(mockResponse(200, JSON.stringify({ success: true })));
    mockGetIDToken.mockResolvedValue('oidc-jwt');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('path traversal protection', () => {
    it('rejects single file path with .. segment', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Create a legitimate coverage file
        await fs.writeFile('lcov.info', 'TN:\nSF:test.js\nend_of_record\n');

        // Attempt to use path traversal
        mockGetInput.mockReturnValue('../../../etc/passwd');

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
        mockGetInput.mockReturnValue('../../sensitive/file.txt');

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
        mockGetInput.mockReturnValue('coverage/../../../etc/passwd');

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
        mockGetInput.mockReturnValue('/etc/passwd');

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
          mockGetInput.mockReturnValue('C:\\Windows\\System32\\config\\SAM');

          await run();

          expect(mockSetFailed).toHaveBeenCalledWith(
            expect.stringContaining(
              'Invalid file path: absolute paths and ".." segments are not allowed',
            ),
          );
          expect(mockPost).not.toHaveBeenCalled();
        } else {
          // On Unix, test with a Unix absolute path instead
          mockGetInput.mockReturnValue('/var/log/system.log');

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

  describe('valid single file path', () => {
    it('accepts and processes valid relative single file path', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        const lcovContent = 'TN:\nSF:src/test.js\nDA:1,5\nend_of_record\n';
        await fs.writeFile('lcov.info', lcovContent);

        mockGetInput.mockReturnValue('lcov.info');

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
        expect(body.repo_name).toBe('org/repo');
        expect(body.commit_sha).toBe('abc123');
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Content-Encoding']).toBeUndefined();

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

        mockGetInput.mockReturnValue('coverage/lcov.info');

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

        mockGetInput.mockReturnValue('lcov1.info lcov2.info');

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
        mockGetInput.mockReturnValue('lcov1.info ../../../etc/passwd');

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
        mockGetInput.mockReturnValue('lcov1.info /etc/passwd');

        await run();

        expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid file path'));
        expect(mockPost).not.toHaveBeenCalled();
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  describe('glob support', () => {
    it('expands a glob pattern and merges the matched reports', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.mkdir('packages/a/coverage', { recursive: true });
        await fs.mkdir('packages/b/coverage', { recursive: true });
        await fs.writeFile(
          'packages/a/coverage/lcov.info',
          'TN:\nSF:src/a.js\nDA:1,5\nend_of_record\n',
        );
        await fs.writeFile(
          'packages/b/coverage/lcov.info',
          'TN:\nSF:src/b.js\nDA:1,3\nend_of_record\n',
        );

        mockGetInput.mockReturnValue('packages/*/coverage/lcov.info');

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        expect(mockPost).toHaveBeenCalled();
        expect(mockInfo).toHaveBeenCalledWith('Upload succeeded.');
      } finally {
        process.chdir(previousCwd);
      }
    });

    it('fails when a glob pattern matches no files', async () => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        mockGetInput.mockReturnValue('packages/*/coverage/lcov.info');

        await run();

        expect(mockSetFailed).toHaveBeenCalledWith(
          expect.stringContaining('No file(s) found matching'),
        );
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
        mockGetInput.mockReturnValue('../../../etc/passwd');

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
        mockGetInput.mockReturnValue('/etc/passwd');

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
        mockGetInput.mockReturnValue('../../.env');

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
        mockGetInput.mockReturnValue('coverage/../../../../../../home/runner/.ssh/id_rsa');

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
        mockGetInput.mockReturnValue('../sensitive.txt');

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
});
