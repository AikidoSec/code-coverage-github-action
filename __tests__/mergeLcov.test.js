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

    expect(merged).toContain('DA:10,5');
    expect(merged).toContain('DA:11,0');
    expect(merged).toContain('DA:12,3');
    expect(merged).toContain('SF:src/b.js');
    expect(merged.match(/^SF:/gm)).toHaveLength(2);
  });

  it('normalizes Windows runner paths before merging multiple inputs', async () => {
    const originalWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = 'D:\\a\\repo\\repo';

    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src/a.cs'), '// source\n');
      await writeLcovFile(
        tmpDir,
        'windows-1.lcov',
        `SF:D:\\a\\repo\\repo\\src\\a.cs
DA:1,1
end_of_record
`,
      );
      await writeLcovFile(
        tmpDir,
        'windows-2.lcov',
        `SF:d:\\A\\Repo\\Repo\\src\\a.cs
DA:1,2
end_of_record
`,
      );

      const merged = await readMerged(['windows-1.lcov', 'windows-2.lcov']);

      expect(merged).toContain('SF:src/a.cs');
      expect(merged).toContain('DA:1,2');
      expect(merged).not.toContain('D:/a/repo');
    } finally {
      if (originalWorkspace === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = originalWorkspace;
      }
    }
  });

  it('throws when no inputs are provided', async () => {
    await expect(mergeLcov([])).rejects.toThrow(/No coverage records/);
  });

  it('normalizes unsafe SF paths containing ..', async () => {
    const lcov = `SF:../library/agent/Agent.js
DA:1,5
end_of_record
`;
    await writeLcovFile(tmpDir, 'unsafe.lcov', lcov);
    const merged = await readMerged(['unsafe.lcov']);

    expect(merged).toContain('SF:library/agent/Agent.js');
    expect(merged).not.toMatch(/\.\./);
  });

  it('merges records that differ only by leading .. in SF paths', async () => {
    const job1 = `SF:../library/agent/Agent.js
DA:10,5
end_of_record
`;
    const job2 = `SF:library/agent/Agent.js
DA:10,2
DA:11,1
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged.match(/^SF:/gm)).toHaveLength(1);
    expect(merged).toContain('SF:library/agent/Agent.js');
    expect(merged).toContain('DA:10,5');
    expect(merged).toContain('DA:11,1');
  });

  it('auto-detects source root when reports use different path roots', async () => {
    const job1 = `SF:pkg/handler.alpha
DA:10,5
end_of_record
SF:util/foo.alpha
DA:1,1
end_of_record
`;
    const job2 = `SF:repo/pkg/handler.beta
DA:10,2
end_of_record
SF:repo/util/foo.beta
DA:1,3
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged.match(/^SF:/gm)).toHaveLength(2);
    expect(merged).toContain('SF:repo/pkg/handler.alpha');
    expect(merged).toContain('SF:repo/util/foo.alpha');
    expect(merged).not.toContain('SF:repo/pkg/handler.beta');
    expect(merged).not.toContain('SF:repo/util/foo.beta');
    expect(merged).toContain('DA:10,5');
    expect(merged).not.toMatch(/^SF:pkg\//m);
    expect(merged).not.toMatch(/^SF:util\//m);
  });

  it('keeps the no-root-directory primary line map when stems collide', async () => {
    const job1 = `SF:pkg/handler.alpha
DA:1,5
DA:2,1
end_of_record
`;
    const job2 = `SF:repo/pkg/handler.beta
DA:1,99
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged.match(/^SF:/gm)).toHaveLength(1);
    expect(merged).toContain('SF:repo/pkg/handler.alpha');
    // Foreign-suffix hits are not applied — keep primary (no root directory) hits only.
    expect(merged).toContain('DA:1,5');
    expect(merged).toContain('DA:2,1');
    expect(merged).not.toContain('DA:1,99');
    expect(merged).not.toContain('SF:repo/pkg/handler.beta');
  });

  it('unions line hits for the same path across inputs', async () => {
    const job1 = `SF:src/a.js
DA:1,10
DA:2,0
end_of_record
`;
    const job2 = `SF:src/a.js
DA:1,3
DA:2,1
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged).toContain('DA:1,10');
    expect(merged).toContain('DA:2,1');
  });

  it('does not mix hits across different suffixes for the same stem', async () => {
    const job1 = `SF:pkg/handler.alpha
DA:1,0
DA:3,4
end_of_record
`;
    const job2 = `SF:pkg/handler.beta
DA:1,5
DA:2,3
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    // Primary is the record with more hit lines (.beta).
    expect(merged.match(/^SF:/gm)).toHaveLength(1);
    expect(merged).toContain('SF:pkg/handler.beta');
    expect(merged).toContain('DA:1,5');
    expect(merged).toContain('DA:2,3');
    expect(merged).not.toContain('DA:3,4');
  });

  it('merges function and branch records and emits FN/FNDA/BRDA summaries', async () => {
    const job1 = `SF:src/a.js
FN:1,foo
FN:5,bar
FNDA:2,foo
FNDA:0,bar
BRDA:3,0,0,-
BRDA:3,0,1,1
DA:1,2
end_of_record
`;
    const job2 = `SF:src/a.js
FN:1,foo
FNDA:5,foo
BRDA:3,0,0,4
BRDA:3,0,1,-
DA:1,1
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged).toContain('FN:1,foo');
    expect(merged).toContain('FN:5,bar');
    expect(merged).toContain('FNDA:5,foo');
    expect(merged).toContain('FNDA:0,bar');
    expect(merged).toContain('FNF:2');
    expect(merged).toContain('FNH:1');
    expect(merged).toContain('BRDA:3,0,0,4');
    expect(merged).toContain('BRDA:3,0,1,1');
    expect(merged).toContain('BRF:2');
    expect(merged).toContain('BRH:2');
  });

  it('keeps untaken branches as "-" when neither side has hits', async () => {
    const lcov = `SF:src/a.js
BRDA:1,0,0,-
BRDA:1,0,1,-
DA:1,0
end_of_record
`;

    await writeLcovFile(tmpDir, 'untaken.lcov', lcov);
    const merged = await readMerged(['untaken.lcov']);

    expect(merged).toContain('BRDA:1,0,0,-');
    expect(merged).toContain('BRDA:1,0,1,-');
    expect(merged).toContain('BRH:0');
  });

  it('throws on absolute SF paths', async () => {
    const lcov = `SF:/tmp/src/a.js
DA:1,1
end_of_record
`;
    await writeLcovFile(tmpDir, 'abs.lcov', lcov);
    await expect(readMerged(['abs.lcov'])).rejects.toThrow(/Invalid source path/);
  });

  it('throws on absolute or parent input paths', async () => {
    await expect(mergeLcov(['/tmp/a.lcov'])).rejects.toThrow(/Invalid file path/);
    await expect(mergeLcov(['../a.lcov'])).rejects.toThrow(/Invalid file path/);
  });

  it('skips empty coverage inputs when aligning path roots', async () => {
    const job1 = `TN:empty
`;
    const job2 = `SF:repo/pkg/handler.js
DA:1,1
end_of_record
`;
    const job3 = `SF:pkg/handler.js
DA:1,3
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    await writeLcovFile(tmpDir, 'job3.lcov', job3);
    const merged = await readMerged(['job1.lcov', 'job2.lcov', 'job3.lcov']);

    expect(merged.match(/^SF:/gm)).toHaveLength(1);
    expect(merged).toContain('SF:repo/pkg/handler.js');
    expect(merged).toContain('DA:1,3');
  });

  it('prefers the denser line map when choosing a primary record', async () => {
    const job1 = `SF:pkg/handler.alpha
DA:1,1
end_of_record
`;
    const job2 = `SF:pkg/handler.beta
DA:1,1
DA:2,1
DA:3,0
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged.match(/^SF:/gm)).toHaveLength(1);
    expect(merged).toContain('SF:pkg/handler.beta');
    expect(merged).toContain('DA:2,1');
    expect(merged).toContain('DA:3,0');
  });

  it('prefers more hit lines when line maps are equally dense', async () => {
    const job1 = `SF:pkg/handler.alpha
DA:1,0
DA:2,0
end_of_record
`;
    const job2 = `SF:pkg/handler.beta
DA:1,1
DA:2,0
end_of_record
`;

    await writeLcovFile(tmpDir, 'job1.lcov', job1);
    await writeLcovFile(tmpDir, 'job2.lcov', job2);
    const merged = await readMerged(['job1.lcov', 'job2.lcov']);

    expect(merged.match(/^SF:/gm)).toHaveLength(1);
    expect(merged).toContain('SF:pkg/handler.beta');
    expect(merged).toContain('DA:1,1');
  });

  it('throws when every coverage path is dropped by the project file network', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src/real.js'), 'export const x = 1;\n');
    await writeLcovFile(
      tmpDir,
      'missing.lcov',
      `SF:src/missing.js
DA:1,1
end_of_record
`,
    );

    await expect(readMerged(['missing.lcov'])).rejects.toThrow(/No coverage records/);
  });

  it('throws when project matching leaves only empty coverage records', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src/empty.js'), 'export {};\n');
    await writeLcovFile(
      tmpDir,
      'past-eof.lcov',
      `SF:src/empty.js
DA:9,1
DA:10,2
end_of_record
`,
    );

    await expect(readMerged(['past-eof.lcov'])).rejects.toThrow(/No coverage records/);
  });
});
