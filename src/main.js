import { promises as fs } from 'node:fs';
import * as core from '@actions/core';
import { readInputs } from './inputs.js';
import { resolveLcovFilePaths } from './resolveLcovFilePaths.js';
import { mergeLcov } from './mergeLcov.js';
import { uploadCoverage } from './aikido.js';

async function run() {
  let failOnError = true;

  try {
    const inputs = readInputs();
    failOnError = inputs.failOnError;

    if (inputs.lcovFilePaths.length === 0) {
      throw new Error(`No lcov file(s) provided. Specify at least one path.`);
    }

    const lcovFilePaths = await resolveLcovFilePaths(inputs.lcovFilePaths);

    core.info(`Found ${lcovFilePaths.length} coverage file(s):`);

    let lcovFilePath = lcovFilePaths[0];
    if (lcovFilePaths.length > 1) {
      core.info(`Merging ${lcovFilePaths.length} coverage file(s) into a single file...`);
      lcovFilePath = await mergeLcov(lcovFilePaths);
    }

    const codeCoverageFileContent = await fs.readFile(lcovFilePath, 'utf8');

    core.info('Uploading coverage report to Aikido...');
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
