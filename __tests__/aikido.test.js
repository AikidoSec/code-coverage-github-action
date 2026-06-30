const mockPostJson = jest.fn();

class HttpClientError extends Error {
  constructor(message, statusCode, result) {
    super(message);
    this.name = 'HttpClientError';
    this.statusCode = statusCode;
    this.result = result;
  }
}

jest.mock('@actions/http-client', () => ({
  HttpClient: jest.fn().mockImplementation(() => ({
    postJson: mockPostJson,
  })),
  HttpCodes: {
    OK: 200,
  },
}));

jest.mock('@actions/core', () => ({
  info: jest.fn(),
}));

const { HttpClient } = require('@actions/http-client');
const { uploadCoverage } = require('../src/aikido');

describe('uploadCoverage', () => {
  const lcovFileContent = 'TN:\nSF:a\nend_of_record\n';
  const token = 'secret-token';

  beforeEach(() => {
    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.GITHUB_SHA = 'abc123';
    process.env.GITHUB_REF_NAME = 'main';
    delete process.env.DEVELOPMENT;
    mockPostJson.mockResolvedValue({ statusCode: 200, result: { success: true } });
  });

  it('posts the coverage payload with the secret header', async () => {
    const result = await uploadCoverage(lcovFileContent, token);

    expect(result).toEqual({ success: true });
    expect(HttpClient).toHaveBeenCalledWith('aikido-code-coverage', [], {
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

  it('throws with the API error message when postJson rejects', async () => {
    mockPostJson.mockRejectedValue(
      new HttpClientError('Failed request: (401)', 401, { message: 'Invalid API key' }),
    );

    await expect(uploadCoverage(lcovFileContent, token)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401 - Invalid API key',
    );
  });

  it('throws with the status code when postJson rejects without a response body', async () => {
    mockPostJson.mockRejectedValue(new HttpClientError('Failed request: (401)', 401));

    await expect(uploadCoverage(lcovFileContent, token)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401',
    );
  });

  it('throws when the response status is not OK', async () => {
    mockPostJson.mockResolvedValue({
      statusCode: 500,
      result: { message: 'Internal server error' },
    });

    await expect(uploadCoverage(lcovFileContent, token)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 500 - Internal server error',
    );
  });

  it('throws with reason_phrase when the API returns that format', async () => {
    const reasonPhrase = "No repository exists with the provided name: 'code-coverage-github-action'";
    mockPostJson.mockRejectedValue(
      new HttpClientError(JSON.stringify({ status_code: 400, reason_phrase: reasonPhrase }), 400, {
        status_code: 400,
        reason_phrase: reasonPhrase,
      }),
    );

    await expect(uploadCoverage(lcovFileContent, token)).rejects.toThrow(
      `Aikido upload failed: Request failed with status code 400 - ${reasonPhrase}`,
    );
  });
});
