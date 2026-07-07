import { jest } from '@jest/globals';

const mockPostJson = jest.fn();
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

const { getAuthHeaders, uploadCoverage } = await import('../src/aikido.js');

class HttpClientError extends Error {
  constructor(message, statusCode, result) {
    super(message);
    this.name = 'HttpClientError';
    this.statusCode = statusCode;
    this.result = result;
  }
}

describe('getAuthHeaders', () => {
  beforeEach(() => {
    delete process.env.DEVELOPMENT;
    mockGetIDToken.mockReset();
    mockSetSecret.mockReset();
  });

  it('returns the secret header when not using OIDC', async () => {
    await expect(getAuthHeaders({ useOidc: false, token: 'secret-token' })).resolves.toEqual({
      'X-AIK-API-SECRET': 'secret-token',
    });
  });

  it('returns a bearer token and masks it when using OIDC', async () => {
    mockGetIDToken.mockResolvedValue('oidc-jwt');

    await expect(getAuthHeaders({ useOidc: true, token: '' })).resolves.toEqual({
      Authorization: 'Bearer oidc-jwt',
    });
    expect(mockGetIDToken).toHaveBeenCalledWith('https://app.aikido.dev');
    expect(mockSetSecret).toHaveBeenCalledWith('oidc-jwt');
  });

  it('throws a friendly error when OIDC is unavailable', async () => {
    mockGetIDToken.mockRejectedValue(new Error('OIDC not available'));

    await expect(getAuthHeaders({ useOidc: true, token: '' })).rejects.toThrow(
      "use-oidc requires OIDC access. Add to your workflow job:\n  permissions:\n    id-token: write",
    );
  });
});

describe('uploadCoverage', () => {
  const lcovFileContent = 'TN:\nSF:a\nend_of_record\n';
  const secretAuth = { useOidc: false, token: 'secret-token' };
  const oidcAuth = { useOidc: true, token: '' };

  beforeEach(() => {
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.GITHUB_SHA = 'abc123';
    process.env.GITHUB_REF_NAME = 'main';
    delete process.env.DEVELOPMENT;
    mockHttpClient.mockImplementation(() => ({
      postJson: mockPostJson,
    }));
    mockPostJson.mockResolvedValue({ statusCode: 200, result: { success: true } });
    mockGetIDToken.mockResolvedValue('oidc-jwt');
    mockSetSecret.mockReset();
  });

  it('posts the coverage payload with the secret header', async () => {
    const result = await uploadCoverage(lcovFileContent, secretAuth);

    expect(result).toEqual({ success: true });
    expect(mockHttpClient).toHaveBeenCalledWith('aikido-code-coverage', [], {
      headers: {
        'X-AIK-API-SECRET': 'secret-token',
        'Content-Type': 'application/json',
      },
    });
    expect(mockPostJson).toHaveBeenCalledWith(
      'https://app.aikido.dev/api/integrations/continuous_integration/scan/code_coverage',
      {
        repo_name: 'org/repo',
        commit_sha: 'abc123',
        branch_name: 'main',
        lcov_file_content: lcovFileContent,
      },
    );
  });

  it('posts the coverage payload with a bearer token when using OIDC', async () => {
    const result = await uploadCoverage(lcovFileContent, oidcAuth);

    expect(result).toEqual({ success: true });
    expect(mockGetIDToken).toHaveBeenCalledWith('https://app.aikido.dev');
    expect(mockSetSecret).toHaveBeenCalledWith('oidc-jwt');
    expect(mockHttpClient).toHaveBeenCalledWith('aikido-code-coverage', [], {
      headers: {
        Authorization: 'Bearer oidc-jwt',
        'Content-Type': 'application/json',
      },
    });
  });

  it('throws with the API error message when postJson rejects', async () => {
    mockPostJson.mockRejectedValue(
      new HttpClientError('Failed request: (401)', 401, { message: 'Invalid API key' }),
    );

    await expect(uploadCoverage(lcovFileContent, secretAuth)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401 - Invalid API key',
    );
  });

  it('throws with the status code when postJson rejects without a response body', async () => {
    mockPostJson.mockRejectedValue(new HttpClientError('Failed request: (401)', 401));

    await expect(uploadCoverage(lcovFileContent, secretAuth)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401',
    );
  });

  it('throws when the response status is not OK', async () => {
    mockPostJson.mockResolvedValue({
      statusCode: 500,
      result: { message: 'Internal server error' },
    });

    await expect(uploadCoverage(lcovFileContent, secretAuth)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 500 - Internal server error',
    );
  });

  it('throws with reason_phrase when the API returns that format', async () => {
    const reasonPhrase =
      "No repository exists with the provided name: 'code-coverage-github-action'";
    mockPostJson.mockRejectedValue(
      new HttpClientError(JSON.stringify({ status_code: 400, reason_phrase: reasonPhrase }), 400, {
        status_code: 400,
        reason_phrase: reasonPhrase,
      }),
    );

    await expect(uploadCoverage(lcovFileContent, secretAuth)).rejects.toThrow(
      `Aikido upload failed: Request failed with status code 400 - ${reasonPhrase}`,
    );
  });
});
