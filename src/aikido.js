import * as core from '@actions/core';
import { HttpClient, HttpCodes } from '@actions/http-client';

const BASE_URL = process.env.DEVELOPMENT ? 'https://app.test.aikido.dev' : 'https://app.aikido.dev';
const OIDC_AUDIENCE = BASE_URL;

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function formatRequestError(statusCode, result, rawBody) {
  const detail = result?.reason_phrase ?? result?.message ?? (rawBody || undefined);

  if (detail) {
    return `Request failed with status code ${statusCode} - ${detail}`;
  }

  return `Request failed with status code ${statusCode}`;
}

/**
 * Resolve request authentication headers for secret-key or OIDC mode.
 */
export async function getAuthHeaders() {
  try {
    const oidcToken = await core.getIDToken(OIDC_AUDIENCE);
    core.setSecret(oidcToken);

    return { Authorization: `Bearer ${oidcToken}` };
  } catch {
    throw new Error(
      'This action uses OIDC to authenticate with Aikido. Add to your workflow job:\n' +
        '  permissions:\n' +
        '    id-token: write',
    );
  }
}

/**
 * Upload a coverage payload to Aikido.
 */
export async function uploadCoverage(codeCoverageFileContent) {
  const authHeaders = await getAuthHeaders();
  const client = new HttpClient('aikido-code-coverage');

  const body = {
    repo_name: process.env.GITHUB_REPOSITORY,
    commit_sha: process.env.GITHUB_SHA,
    branch_name: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME,
    code_coverage_file_content: codeCoverageFileContent,
  };

  const url = `${BASE_URL}/api/integrations/continuous_integration/scan/code_coverage`;

  const response = await client.post(url, JSON.stringify(body), {
    ...authHeaders,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });

  const rawBody = await response.readBody();
  const statusCode = response.message.statusCode;
  const result = parseJsonBody(rawBody);

  if (statusCode !== HttpCodes.OK) {
    throw new Error(`Aikido upload failed: ${formatRequestError(statusCode, result, rawBody)}`);
  }

  return result;
}
