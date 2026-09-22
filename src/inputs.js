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
    core.error(
      'Both aikido-token and OIDC (id-token: write) are configured. ' +
        'If you intend to use secret-key auth only, remove id-token: write from the job and use the aikido-token input instead.',
    );
  }

  return {
    filePaths,
    failOnError,
    region,
    aikidoToken,
  };
}
