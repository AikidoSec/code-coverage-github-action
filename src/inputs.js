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
  const format = core.getInput('format', { required: true, trimWhitespace: true });

  if (format !== 'lcov' && format !== 'cobertura') {
    throw new Error('Invalid format: must be lcov or cobertura');
  }

  return {
    filePaths,
    failOnError,
    region,
    format,
  };
}
