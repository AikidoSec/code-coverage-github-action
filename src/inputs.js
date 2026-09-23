import * as core from '@actions/core';

/**
 * Read and validate the action inputs.
 */
export function readInputs() {
  const filePathsInput = core.getInput('file-paths', {
    required: true,
    trimWhitespace: true,
  });

  const filePaths = filePathsInput
    .split(/\n|\s+|,/)
    .map((filePath) => filePath.trim())
    .filter(Boolean);

  const failOnError = core.getBooleanInput('fail-on-error');
  const region = core.getInput('region', { required: false, trimWhitespace: true }) || 'eu';

  const aikidoToken = core.getInput('aikido-token', {
    required: false,
    trimWhitespace: true,
  });

  const oidcEnabled = Boolean(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  );

  if (aikidoToken && oidcEnabled) {
    throw new Error(
      'Both aikido-token and OIDC (id-token: write) are configured. ' +
        'Remove one authentication method before continuing.',
    );
  }

  return {
    filePaths,
    failOnError,
    region,
    aikidoToken,
  };
}
