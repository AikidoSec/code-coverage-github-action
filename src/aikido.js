import * as core from '@actions/core';
import { HttpClient, HttpCodes } from '@actions/http-client';
import { gzipSync } from 'node:zlib';

const REGION_BASE_URLS = {
  eu: 'https://bg.aikido.dev',
  us: 'https://bg.us.aikido.dev',
  me: 'https://bg.me.aikido.dev',
  au: 'https://bg.au.aikido.dev',
  'us-gov': 'https://bg.aikidogov.us',
};

export function getBaseUrl(region = '') {
  if (process.env.DEVELOPMENT) {
    return 'https://app.test.aikido.dev';
  }

  const normalized = (region || 'eu').toLowerCase().trim();
  const baseUrl = REGION_BASE_URLS[normalized];

  if (!baseUrl) {
    throw new Error(
      `Unknown region "${region}". Supported regions: ${Object.keys(REGION_BASE_URLS).join(', ')}`,
    );
  }

  return baseUrl;
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
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown region')) {
      throw error;
    }

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
