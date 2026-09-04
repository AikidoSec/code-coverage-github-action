import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as core from '@actions/core';
import { readInputs } from './inputs.js';
import { normalizeLcovSourcePaths } from './lcovPaths.js';
import { mergeLcov } from './mergeLcov.js';
import { uploadCoverage } from './aikido.js';

/**
 * Validate that a file path is safe to read.
 * Rejects absolute paths and paths containing '..' segments to prevent
 * directory traversal and arbitrary file access.
 */
function validateFilePath(filePath) {
  if (filePath.includes('..') || path.isAbsolute(filePath)) {
    throw new Error('Invalid file path: absolute paths and ".." segments are not allowed');
  }
}

async function run() {
  let failOnError = true;

  try {
    const inputs = readInputs();
    failOnError = inputs.failOnError;

    if (inputs.lcovFilePaths.length === 0) {
      throw new Error(`No lcov file(s) provided. Specify at least one path.`);
    }

    core.info(
      `Found ${inputs.lcovFilePaths.length} coverage file(s) at path(s) \n\t${inputs.lcovFilePaths.join('\n\t')}`,
    );

    let codeCoverageFileContent = null;

    if (inputs.lcovFilePaths.length > 1) {
      core.info(`Merging ${inputs.lcovFilePaths.length} coverage file(s) into a single file...`);
      const mergedLcovFilePath = await mergeLcov(inputs.lcovFilePaths);
      codeCoverageFileContent = await fs.readFile(mergedLcovFilePath, 'utf8');
    } else {
      // Validate single path to prevent arbitrary file access
      const lcovFilePath = inputs.lcovFilePaths[0];
      validateFilePath(lcovFilePath);

      const content = await fs.readFile(path.resolve(lcovFilePath), 'utf8');
      const repositoryRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
      codeCoverageFileContent = normalizeLcovSourcePaths(content, repositoryRoot);
    }

    if (codeCoverageFileContent === null) {
      throw new Error('Something went wrong while validating the coverage file(s)');
    }

    core.info(
      `Uploading coverage report for branch ${process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME} to Aikido...`,
    );
    await uploadCoverage(codeCoverageFileContent);

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

export { run };

run();
