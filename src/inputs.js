import * as core from '@actions/core';

/**
 * Read and validate the action inputs.
 */
export function readInputs() {
  const lcovFilePathsInput = core.getInput('lcov-file-paths', {
    required: true,
    trimWhitespace: true,
  });

  const lcovFilePaths = lcovFilePathsInput
    .split(/\n|\s+|,/)
    .map((filePath) => filePath.trim())
    .filter(Boolean);

  const failOnError = core.getBooleanInput('fail-on-error');
  const region = core.getInput('region', { required: false, trimWhitespace: true }) || 'eu';

  return {
    lcovFilePaths,
    failOnError,
    region,
  };
}
