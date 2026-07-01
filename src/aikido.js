import { HttpClient, HttpCodes } from '@actions/http-client';

const BASE_URL = process.env.DEVELOPMENT ? 'https://app.test.aikido.dev' : 'https://app.aikido.dev';

function formatRequestError(statusCode, result) {
  const detail = result?.reason_phrase ?? result?.message;
  return detail
    ? `Request failed with status code ${statusCode} - ${detail}`
    : `Request failed with status code ${statusCode}`;
}

/**
 * Upload a coverage payload to Aikido.
 */
export async function uploadCoverage(lcovFileContent, token) {
  const client = new HttpClient('aikido-code-coverage', [], {
    headers: {
      'X-AIK-API-SECRET': token,
      'Content-Type': 'application/json',
    },
  });

  const body = {
    repo_name: process.env.GITHUB_REPOSITORY,
    commit_sha: process.env.GITHUB_SHA,
    branch_name: process.env.GITHUB_REF_NAME,
    lcov_file_content: lcovFileContent,
  };

  const url = `${BASE_URL}/api/integrations/continuous_integration/scan/code_coverage`;

  let statusCode;
  let result;

  try {
    ({ statusCode, result } = await client.postJson(url, body));
  } catch (error) {
    if (error.name !== 'HttpClientError') throw error;
    statusCode = error.statusCode;
    result = error.result ?? parseErrorBody(error.message);
  }

  if (statusCode !== HttpCodes.OK) {
    throw new Error(`Aikido upload failed: ${formatRequestError(statusCode, result)}`);
  }

  return result;
}

function parseErrorBody(message) {
  try {
    return JSON.parse(message);
  } catch {
    return undefined;
  }
}
