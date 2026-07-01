import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeLcov } from '../src/mergeLcov.js';

const SAMPLE = `SF:src/a.js
DA:1,3
DA:2,0
end_of_record
SF:src/b.js
DA:1,0
end_of_record
`;

async function writeLcovFile(dir, name, content) {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

describe('mergeLcov', () => {
  let tmpDir;
  const mergedDirs = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-lcov-'));
  });

  afterEach(async () => {
    for (const dir of mergedDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function readMerged(paths) {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const mergedPath = await mergeLcov(paths);
      mergedDirs.push(path.dirname(mergedPath));
      return fs.readFile(mergedPath, 'utf8');
    } finally {
      process.chdir(previousCwd);
    }
  }

  it('preserves a single input file', async () => {
    await writeLcovFile(tmpDir, 'single.lcov', SAMPLE);
    const merged = await readMerged(['single.lcov']);

    expect(merged).toContain('DA:1,3');
    expect(merged).toContain('DA:2,0');
    expect(merged).toContain('SF:src/a.js');
    expect(merged).toContain('SF:src/b.js');
    expect(merged.match(/^SF:/gm)).toHaveLength(2);
  });

  it('combines records from multiple inputs', async () => {
    const job1 = `SF:src/a.js
DA:10,5
DA:11,0
end_of_record
`;
    const job2 = `SF:src/a.js
DA:10,2
DA:12,3
end_of_record
SF:src/b.js
DA:1,1
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged).toContain('DA:10,7');
    expect(merged).toContain('DA:11,0');
    expect(merged).toContain('DA:12,3');
    expect(merged).toContain('SF:src/b.js');
    expect(merged.match(/^SF:/gm)).toHaveLength(2);
  });

  it('throws when no inputs are provided', async () => {
    await expect(mergeLcov([])).rejects.toThrow(/No coverage records/);
  });
});
