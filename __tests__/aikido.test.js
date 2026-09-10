import { jest } from '@jest/globals';
import { gunzipSync } from 'node:zlib';

const mockPost = jest.fn();
const mockHttpClient = jest.fn();
const mockGetIDToken = jest.fn();
const mockSetSecret = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  getIDToken: mockGetIDToken,
  setSecret: mockSetSecret,
}));

jest.unstable_mockModule('@actions/http-client', () => ({
  HttpClient: mockHttpClient,
  HttpCodes: {
    OK: 200,
  },
}));

const { getAuthHeaders, getBaseUrl, uploadCoverage } = await import('../src/aikido.js');

function mockResponse(statusCode, rawBody = '') {
  return {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(rawBody),
  };
}

function decodeCoverageContent(encoded) {
  return gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
}

describe('getBaseUrl', () => {
  beforeEach(() => {
    delete process.env.DEVELOPMENT;
  });

  it.each([
    ['', 'https://bg.aikido.dev'],
    ['eu', 'https://bg.aikido.dev'],
    ['EU', 'https://bg.aikido.dev'],
    ['us', 'https://bg.us.aikido.dev'],
    ['me', 'https://bg.me.aikido.dev'],
    ['au', 'https://bg.au.aikido.dev'],
    ['us-gov', 'https://bg.aikidogov.us'],
  ])('maps region %j to %s', (region, url) => {
    expect(getBaseUrl(region)).toBe(url);
  });

  it('throws for an unknown region', () => {
    expect(() => getBaseUrl('mars')).toThrow(
      'Unknown region "mars". Supported regions: eu, us, me, au, us-gov',
    );
  });

  it('uses the development URL when DEVELOPMENT is set', () => {
    process.env.DEVELOPMENT = 'true';
    expect(getBaseUrl('us')).toBe('https://app.test.aikido.dev');
  });
});

describe('getAuthHeaders', () => {
  beforeEach(() => {
    delete process.env.DEVELOPMENT;
    mockGetIDToken.mockReset();
    mockSetSecret.mockReset();
  });

  it('returns a bearer token and masks it', async () => {
    mockGetIDToken.mockResolvedValue('oidc-jwt');

    await expect(getAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer oidc-jwt',
    });
    expect(mockGetIDToken).toHaveBeenCalledWith('https://bg.aikido.dev');
    expect(mockSetSecret).toHaveBeenCalledWith('oidc-jwt');
  });

  it('uses the region base URL as the OIDC audience', async () => {
    mockGetIDToken.mockResolvedValue('oidc-jwt');

    await getAuthHeaders('us');

    expect(mockGetIDToken).toHaveBeenCalledWith('https://bg.us.aikido.dev');
  });

  it('throws a friendly error when OIDC is unavailable', async () => {
    mockGetIDToken.mockRejectedValue(new Error('OIDC not available'));

    await expect(getAuthHeaders()).rejects.toThrow(
      'This action uses OIDC to authenticate with Aikido. Add to your workflow job:\n  permissions:\n    id-token: write',
    );
  });

  it('rethrows unknown region errors', async () => {
    await expect(getAuthHeaders('mars')).rejects.toThrow('Unknown region "mars"');
    expect(mockGetIDToken).not.toHaveBeenCalled();
  });
});

describe('uploadCoverage', () => {
  const codeCoverageFileContent = 'TN:\nSF:a\nend_of_record\n';

  beforeEach(() => {
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.GITHUB_SHA = 'abc123';
    process.env.GITHUB_HEAD_REF = 'main';
    delete process.env.DEVELOPMENT;
    mockHttpClient.mockImplementation(() => ({
      post: mockPost,
    }));
    mockPost.mockResolvedValue(mockResponse(200, JSON.stringify({ success: true })));
    mockGetIDToken.mockResolvedValue('oidc-jwt');
    mockSetSecret.mockReset();
  });

  it('posts the coverage payload with a bearer token', async () => {
    const result = await uploadCoverage(codeCoverageFileContent);

    expect(result).toEqual({ success: true });
    expect(mockGetIDToken).toHaveBeenCalledWith('https://bg.aikido.dev');
    expect(mockSetSecret).toHaveBeenCalledWith('oidc-jwt');
    expect(mockHttpClient).toHaveBeenCalledWith('aikido-code-coverage');
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, rawBody, headers] = mockPost.mock.calls[0];
    expect(url).toBe(
      'https://bg.aikido.dev/api/integrations/continuous_integration/scan/code_coverage',
    );
    const body = JSON.parse(rawBody);
    expect(body).toEqual({
      repo_name: 'org/repo',
      commit_sha: 'abc123',
      branch_name: 'main',
      code_coverage_file_content: expect.any(String),
    });
    expect(decodeCoverageContent(body.code_coverage_file_content)).toBe(codeCoverageFileContent);
    expect(headers).toEqual({
      Authorization: 'Bearer oidc-jwt',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });

  it('throws with reason_phrase from the JSON body', async () => {
    mockPost.mockResolvedValue(
      mockResponse(
        401,
        JSON.stringify({ status_code: 401, reason_phrase: 'OIDC token audience mismatch.' }),
      ),
    );

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401 - OIDC token audience mismatch.',
    );
  });

  it('throws with the API message when reason_phrase is absent', async () => {
    mockPost.mockResolvedValue(mockResponse(401, JSON.stringify({ message: 'Invalid API key' })));

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401 - Invalid API key',
    );
  });

  it('throws with the raw body when JSON has no known error fields', async () => {
    mockPost.mockResolvedValue(mockResponse(401, JSON.stringify({ unexpected: true })));

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401 - {"unexpected":true}',
    );
  });

  it('throws with the status code when the response body is empty', async () => {
    mockPost.mockResolvedValue(mockResponse(401, ''));

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401',
    );
  });

  it('throws with the raw body when the response is not JSON', async () => {
    mockPost.mockResolvedValue(mockResponse(500, 'Internal server error'));

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 500 - Internal server error',
    );
  });
});
