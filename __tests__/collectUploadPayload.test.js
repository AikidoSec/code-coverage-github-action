import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectUploadPayload } from '../src/collectUploadPayload.js';

describe('collectUploadPayload', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collect-payload-'));
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src/app.js'), 'line1\nline2\nline3\n');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('builds repository_source_paths, eof, and files from coverage inputs', async () => {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    process.env.GITHUB_WORKSPACE = tmpDir;

    try {
      const lcov = 'SF:src/app.js\nDA:1,1\nend_of_record\n';
      await fs.writeFile('coverage.lcov', lcov);

      const payload = await collectUploadPayload(['coverage.lcov']);

      expect(payload.repository_source_paths).toContain('src/app.js');
      expect(payload.eof['src/app.js']).toBe(4);
      expect(payload.files).toEqual([
        {
          filename: 'coverage.lcov',
          format: 'lcov',
          content: lcov,
        },
      ]);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('rejects empty file path list', async () => {
    await expect(collectUploadPayload([])).rejects.toThrow(/No code coverage file/);
  });
});
