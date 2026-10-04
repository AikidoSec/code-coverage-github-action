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

  return {
    filePaths,
    failOnError,
    region,
  };
}
