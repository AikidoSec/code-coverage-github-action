import * as core from '@actions/core';

/**
 * Read and validate the action inputs.
 */
export function readInputs() {
  const useOidc = core.getBooleanInput('use-oidc');
  const aikidoCiToken = core.getInput('aikido-ci-token', {
    required: false,
    trimWhitespace: true,
  });

  if (useOidc && aikidoCiToken) {
    throw new Error("Set either 'use-oidc: true' or 'aikido-ci-token', not both.");
  }
  if (!useOidc && !aikidoCiToken) {
    throw new Error("Provide 'aikido-ci-token' or set 'use-oidc: true'.");
  }

  const lcovFilePathsInput = core.getInput('lcov-file-paths', {
    required: true,
    trimWhitespace: true,
  });
  const lcovFilePaths = lcovFilePathsInput
    .split(/\n|\s+|,/)
    .map((filePath) => filePath.trim())
    .filter(Boolean);
  const failOnError = core.getBooleanInput('fail-on-error');

  return {
    useOidc,
    aikidoCiToken,
    lcovFilePaths,
    failOnError,
  };
}
