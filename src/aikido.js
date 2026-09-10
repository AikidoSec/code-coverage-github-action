import * as core from '@actions/core';
import { HttpClient, HttpCodes } from '@actions/http-client';
import { gzipSync } from 'node:zlib';

function getBaseUrl(region) {
  if (process.env.DEVELOPMENT) {
    return 'https://app.test.aikido.dev';
  }

  switch (region) {
    case 'us':
      return 'https://bg.us.aikido.dev';
    case 'me':
      return 'https://bg.me.aikido.dev';
    case 'au':
      return 'https://bg.au.aikido.dev';
    case 'us-gov':
      return 'https://bg.aikidogov.us';
    default:
      return 'https://bg.aikido.dev';
  }
}

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
export async function getAuthHeaders(region = '') {
  try {
    const oidcAudience = getBaseUrl(region);
    const oidcToken = await core.getIDToken(oidcAudience);
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
export async function uploadCoverage(codeCoverageFileContent, region = '') {
  const authHeaders = await getAuthHeaders(region);
  const client = new HttpClient('aikido-code-coverage');

  const body = {
    repo_name: process.env.GITHUB_REPOSITORY,
    commit_sha: process.env.GITHUB_SHA,
    branch_name: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME,
    code_coverage_file_content: gzipSync(codeCoverageFileContent).toString('base64'),
  };

  const baseUrl = getBaseUrl(region);
  const url = `${baseUrl}/api/integrations/continuous_integration/scan/code_coverage`;

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
