import { jest } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const mockInfo = jest.fn();
const mockSetFailed = jest.fn();
const mockWarning = jest.fn();
const mockError = jest.fn();
const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();
const mockPost = jest.fn();
const mockHttpClient = jest.fn();
const mockGetIDToken = jest.fn();
const mockSetSecret = jest.fn();
const originalGitHubWorkspace = process.env.GITHUB_WORKSPACE;

const OIDC_URL = 'ACTIONS_ID_TOKEN_REQUEST_URL';
const OIDC_TOKEN = 'ACTIONS_ID_TOKEN_REQUEST_TOKEN';

function decodeCoverageContent(encoded) {
  return gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
}

jest.unstable_mockModule('@actions/core', () => ({
  info: mockInfo,
  setFailed: mockSetFailed,
  warning: mockWarning,
  error: mockError,
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

const { run } = await import('../../src/main.js');

function mockResponse(statusCode, rawBody = '') {
  return {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(rawBody),
  };
}

describe('e2e static token auth', () => {
  let tmpDir;
  const lcovContent = 'TN:\nSF:src/app.js\nDA:1,5\nend_of_record\n';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-token-'));

    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.GITHUB_SHA = 'abc123';
    process.env.GITHUB_HEAD_REF = 'main';
    process.env.GITHUB_WORKSPACE = tmpDir;
    delete process.env.DEVELOPMENT;
    delete process.env[OIDC_URL];
    delete process.env[OIDC_TOKEN];

    mockInfo.mockClear();
    mockSetFailed.mockClear();
    mockWarning.mockClear();
    mockError.mockClear();
    mockGetInput.mockClear();
    mockGetBooleanInput.mockClear();
    mockPost.mockClear();
    mockHttpClient.mockClear();
    mockGetIDToken.mockClear();
    mockSetSecret.mockClear();

    mockGetBooleanInput.mockReturnValue(true);
    mockHttpClient.mockImplementation(() => ({
      post: mockPost,
    }));
    mockPost.mockResolvedValue(mockResponse(200, JSON.stringify({ success: true })));
    mockGetIDToken.mockResolvedValue('oidc-jwt');
  });

  afterEach(async () => {
    delete process.env[OIDC_URL];
    delete process.env[OIDC_TOKEN];
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalGitHubWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE;
    } else {
      process.env.GITHUB_WORKSPACE = originalGitHubWorkspace;
    }
  });

  function configureInputs({ region = 'eu', aikidoToken = '' } = {}) {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'lcov.info';
      }
      if (name === 'region') {
        return region;
      }
      if (name === 'aikido-token') {
        return aikidoToken;
      }
      return '';
    });
  }

  async function seedCoverageRepo() {
    await fs.mkdir('.git', { recursive: true });
    await fs.mkdir('src', { recursive: true });
    await fs.writeFile('src/app.js', 'a\nb\n');
    await fs.writeFile('lcov.info', lcovContent);
  }

  it('uploads with aikido-token and does not request OIDC', async () => {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      await seedCoverageRepo();
      configureInputs({ aikidoToken: 'static-ci-token' });

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockError).not.toHaveBeenCalled();
      expect(mockGetIDToken).not.toHaveBeenCalled();
      expect(mockSetSecret).not.toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledTimes(1);

      const [url, rawBody, headers] = mockPost.mock.calls[0];
      expect(url).toBe(
        'https://bg.aikido.dev/api/integrations/continuous_integration/scan/code_coverage',
      );

      const body = JSON.parse(rawBody);
      expect(body.files).toHaveLength(1);
      expect(decodeCoverageContent(body.files[0].content)).toBe(lcovContent);
      expect(headers).toEqual({
        Authorization: 'Bearer static-ci-token',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });

      expect(mockInfo).toHaveBeenCalledWith('Upload succeeded.');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('fails when both aikido-token and OIDC are configured', async () => {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      process.env[OIDC_URL] = 'https://example.actions.githubusercontent.com';
      process.env[OIDC_TOKEN] = 'request-token';

      await seedCoverageRepo();
      configureInputs({ aikidoToken: 'static-ci-token' });

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'Both aikido-token and OIDC (id-token: write) are configured. ' +
          'Remove one authentication method before continuing.',
      );
      expect(mockGetIDToken).not.toHaveBeenCalled();
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockInfo).not.toHaveBeenCalledWith('Upload succeeded.');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
