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

const { run } = await import('../../src/main.js');

function mockResponse(statusCode, rawBody = '') {
  return {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(rawBody),
  };
}

const REGIONS = [
  { region: 'eu', baseUrl: 'https://bg.aikido.dev' },
  { region: 'us', baseUrl: 'https://bg.us.aikido.dev' },
  { region: 'me', baseUrl: 'https://bg.me.aikido.dev' },
  { region: 'au', baseUrl: 'https://bg.au.aikido.dev' },
  { region: 'us-gov', baseUrl: 'https://bg.aikidogov.us' },
];

describe('e2e multi-region OIDC and upload URLs', () => {
  let tmpDir;
  const lcovContent = 'TN:\nSF:src/app.js\nDA:1,5\nend_of_record\n';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-region-'));

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

  afterAll(() => {
    if (originalGitHubWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE;
    } else {
      process.env.GITHUB_WORKSPACE = originalGitHubWorkspace;
    }
  });

  function configureInputs(region) {
    mockGetInput.mockImplementation((name) => {
      if (name === 'lcov-file-paths') {
        return 'lcov.info';
      }
      if (name === 'region') {
        return region;
      }
      return '';
    });
  }

  it.each(REGIONS)(
    'requests OIDC and uploads to $region without a real network call',
    async ({ region, baseUrl }) => {
      const previousCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await fs.writeFile('lcov.info', lcovContent);
        configureInputs(region);

        await run();

        expect(mockSetFailed).not.toHaveBeenCalled();
        expect(mockGetIDToken).toHaveBeenCalledWith(baseUrl);
        expect(mockSetSecret).toHaveBeenCalledWith('oidc-jwt');
        expect(mockPost).toHaveBeenCalledTimes(1);

        const [url, rawBody, headers] = mockPost.mock.calls[0];
        expect(url).toBe(`${baseUrl}/api/integrations/continuous_integration/scan/code_coverage`);

        const body = JSON.parse(rawBody);
        expect(decodeCoverageContent(body.code_coverage_file_content)).toBe(lcovContent);
        expect(headers).toEqual({
          Authorization: 'Bearer oidc-jwt',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        });

        expect(mockInfo).toHaveBeenCalledWith(`Uploading coverage report to Aikido (${region})...`);
        expect(mockInfo).toHaveBeenCalledWith('Upload succeeded.');
      } finally {
        process.chdir(previousCwd);
      }
    },
  );

  it('fails cleanly for an unknown region without posting', async () => {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      await fs.writeFile('lcov.info', lcovContent);
      configureInputs('mars');

      await run();

      expect(mockPost).not.toHaveBeenCalled();
      expect(mockGetIDToken).not.toHaveBeenCalled();
      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Unknown region "mars"'));
    } finally {
      process.chdir(previousCwd);
    }
  });
});
