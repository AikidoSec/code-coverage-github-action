import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as core from '@actions/core';
import { readInputs } from './inputs.js';
import { mergeLcov, normalizeLcovSourcePaths } from './formats/lcov.js';
import { mergeCobertura, normalizeCoberturaSourcePaths } from './formats/cobertura.js';
import { uploadCoverage } from './aikido.js';
import { validateFilePath } from './paths.js';

async function run() {
  let failOnError = true;

  try {
    const inputs = readInputs();
    failOnError = inputs.failOnError;

    if (inputs.filePaths.length === 0) {
      throw new Error(`No code coverage file(s) provided. Specify at least one path.`);
    }

    core.info(
      `Found ${inputs.filePaths.length} coverage file(s) at path(s) \n\t${inputs.filePaths.join('\n\t')}`,
    );

    const codeCoverageFileContent = await loadCodeCoverageContent(inputs.filePaths, inputs.format);

    if (codeCoverageFileContent === null) {
      throw new Error('Something went wrong while validating the coverage file(s)');
    }

    core.info(
      `Uploading coverage report for branch ${process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME} to Aikido...`,
    );
    await uploadCoverage(codeCoverageFileContent, inputs.region, inputs.format);

    core.info(`Upload succeeded.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (failOnError) {
      core.setFailed(message);
    } else {
      core.warning(`Coverage upload skipped: ${message}`);
    }
  }
}

async function loadCodeCoverageContent(filePaths, format) {
  if (filePaths.length > 1) {
    core.info(`Merging ${filePaths.length} coverage file(s) into a single file...`);

    let mergedContent = null;

    if (format === 'lcov') {
      mergedContent = await mergeLcov(filePaths);
    } else if (format === 'cobertura') {
      mergedContent = await mergeCobertura(filePaths);
    }

    return fs.readFile(mergedContent, 'utf8');
  }

  const filePath = filePaths[0];
  validateFilePath(filePath);

  const content = await fs.readFile(path.resolve(filePath), 'utf8');
  const repositoryRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();

  if (format === 'cobertura') {
    return normalizeCoberturaSourcePaths(content, repositoryRoot);
  }

  // default to lcov
  return normalizeLcovSourcePaths(content, repositoryRoot);
}

export { run };
run();
