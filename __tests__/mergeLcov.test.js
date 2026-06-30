const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { mergeLcov } = require('../src/mergeLcov');

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
    const mergedPath = await mergeLcov(paths);
    mergedDirs.push(path.dirname(mergedPath));
    return fs.readFile(mergedPath, 'utf8');
  }

  it('preserves a single input file', async () => {
    const input = await writeLcovFile(tmpDir, 'single.lcov', SAMPLE);
    const merged = await readMerged([input]);

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

    const input1 = await writeLcovFile(tmpDir, 'job1.lcov', job1);
    const input2 = await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged([input1, input2]);

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
