const fs = require('fs').promises;
const core = require('@actions/core');
const { readInputs } = require('./inputs');
const { mergeLcov } = require('./mergeLcov');
const { uploadCoverage } = require('./aikido');

async function run() {
  let failOnError = true;

  try {
    const inputs = readInputs();
    failOnError = inputs.failOnError;

    if (inputs.lcovFilePaths.length === 0) {
      throw new Error(`No lcov file(s) provided. Specify at least one path.`);
    }
    core.info(`Found ${inputs.lcovFilePaths.length} coverage file(s):`);

    let lcovFilePath = inputs.lcovFilePaths[0];
    if (inputs.lcovFilePaths.length > 1) {
      core.info(`Merging ${inputs.lcovFilePaths.length} coverage file(s) into a single file...`);
      lcovFilePath = await mergeLcov(inputs.lcovFilePaths);
    }

    const lcovFileContent = await fs.readFile(lcovFilePath, 'utf8');

    core.info('Uploading coverage report to Aikido...');
    await uploadCoverage(lcovFileContent, inputs.aikidoCiToken);

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

module.exports = { run };

run();
