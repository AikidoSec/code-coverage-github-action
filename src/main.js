import * as core from '@actions/core';
import { readInputs } from './inputs.js';
import { collectUploadPayload } from './collectUploadPayload.js';
import { uploadCoverage } from './aikido.js';

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

    core.info('Collecting repository_source_paths and EOF metadata...');
    const payload = await collectUploadPayload(inputs.filePaths);

    core.info(
      `Uploading ${payload.files.length} coverage file(s) (repository_source_paths=${payload.repository_source_paths.length}, eof=${Object.keys(payload.eof).length}) for branch ${process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME} to Aikido...`,
    );
    await uploadCoverage(payload, inputs.region);

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
