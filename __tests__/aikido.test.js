import { jest } from '@jest/globals';
import { gunzipSync } from 'node:zlib';

const mockSendStream = jest.fn();
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

function mockResponse(statusCode, rawBody = '') {
  return {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(rawBody),
  };
}

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
    expect(mockGetIDToken).toHaveBeenCalledWith('https://app.aikido.dev');
    expect(mockSetSecret).toHaveBeenCalledWith('oidc-jwt');
  });

  it('throws a friendly error when OIDC is unavailable', async () => {
    mockGetIDToken.mockRejectedValue(new Error('OIDC not available'));

    await expect(getAuthHeaders()).rejects.toThrow(
      'This action uses OIDC to authenticate with Aikido. Add to your workflow job:\n  permissions:\n    id-token: write',
    );
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
      sendStream: mockSendStream,
    }));
    mockSendStream.mockResolvedValue(mockResponse(200, JSON.stringify({ success: true })));
    mockGetIDToken.mockResolvedValue('oidc-jwt');
    mockSetSecret.mockReset();
  });

  it('posts the coverage payload with a bearer token', async () => {
    const result = await uploadCoverage(codeCoverageFileContent);

    expect(result).toEqual({ success: true });
    expect(mockGetIDToken).toHaveBeenCalledWith('https://app.aikido.dev');
    expect(mockSetSecret).toHaveBeenCalledWith('oidc-jwt');
    expect(mockHttpClient).toHaveBeenCalledWith('aikido-code-coverage');
    expect(mockSendStream).toHaveBeenCalledTimes(1);
    const [verb, url, bodyStream, headers] = mockSendStream.mock.calls[0];
    expect(verb).toBe('POST');
    expect(url).toBe(
      'https://app.aikido.dev/api/integrations/continuous_integration/scan/code_coverage',
    );
    const body = Buffer.concat(await bodyStream.toArray());
    expect(JSON.parse(gunzipSync(body).toString('utf8'))).toEqual({
      repo_name: 'org/repo',
      commit_sha: 'abc123',
      branch_name: 'main',
      code_coverage_file_content: codeCoverageFileContent,
    });
    expect(headers).toEqual({
      Authorization: 'Bearer oidc-jwt',
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': String(body.length),
      Accept: 'application/json',
    });
  });

  it('throws with reason_phrase from the JSON body', async () => {
    mockSendStream.mockResolvedValue(
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
    mockSendStream.mockResolvedValue(
      mockResponse(401, JSON.stringify({ message: 'Invalid API key' })),
    );

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401 - Invalid API key',
    );
  });

  it('throws with the raw body when JSON has no known error fields', async () => {
    mockSendStream.mockResolvedValue(mockResponse(401, JSON.stringify({ unexpected: true })));

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401 - {"unexpected":true}',
    );
  });

  it('throws with the status code when the response body is empty', async () => {
    mockSendStream.mockResolvedValue(mockResponse(401, ''));

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 401',
    );
  });

  it('throws with the raw body when the response is not JSON', async () => {
    mockSendStream.mockResolvedValue(mockResponse(500, 'Internal server error'));

    await expect(uploadCoverage(codeCoverageFileContent)).rejects.toThrow(
      'Aikido upload failed: Request failed with status code 500 - Internal server error',
    );
  });
});
