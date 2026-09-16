import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeCobertura } from '../src/formats/cobertura.js';

function coberturaFor(filename, lines) {
  const lineXml = lines
    .map(([number, hits]) => `<line number="${number}" hits="${hits}" branch="false"/>`)
    .join('\n            ');

  return `<?xml version="1.0" ?>
<coverage line-rate="1" branch-rate="1" lines-covered="1" lines-valid="1" branches-covered="0" branches-valid="0">
  <sources>
    <source>.</source>
  </sources>
  <packages>
    <package name="" line-rate="1" branch-rate="1">
      <classes>
        <class name="${filename}" filename="${filename}" line-rate="1" branch-rate="1">
          <lines>
            ${lineXml}
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;
}

async function writeCoberturaFile(dir, name, content) {
  const filePath = path.join(dir, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return filePath;
}

describe('mergeCobertura', () => {
  let tmpDir;
  const mergedDirs = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-cobertura-'));
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
      const mergedPath = await mergeCobertura(paths);
      mergedDirs.push(path.dirname(mergedPath));
      return fs.readFile(mergedPath, 'utf8');
    } finally {
      process.chdir(previousCwd);
    }
  }

  it('preserves a single input file', async () => {
    await writeCoberturaFile(
      tmpDir,
      'cobertura.xml',
      coberturaFor('src/a.js', [
        [1, 3],
        [2, 0],
      ]),
    );
    const merged = await readMerged(['cobertura.xml']);

    expect(merged).toContain('filename="src/a.js"');
    expect(merged).toMatch(/number="1"[^>]*hits="3"/);
    expect(merged).toMatch(/number="2"[^>]*hits="0"/);
  });

  it('merges max hits for the same filename across inputs', async () => {
    await writeCoberturaFile(
      tmpDir,
      'job1/cobertura.xml',
      coberturaFor('src/a.js', [
        [10, 5],
        [11, 0],
      ]),
    );
    await writeCoberturaFile(
      tmpDir,
      'job2/cobertura.xml',
      `<?xml version="1.0" ?>
<coverage line-rate="1" branch-rate="1">
  <sources><source>.</source></sources>
  <packages>
    <package name="">
      <classes>
        <class name="a" filename="src/a.js">
          <lines>
            <line number="10" hits="2" branch="false"/>
            <line number="12" hits="3" branch="false"/>
          </lines>
        </class>
        <class name="b" filename="src/b.js">
          <lines>
            <line number="1" hits="1" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`,
    );

    const merged = await readMerged(['job1/cobertura.xml', 'job2/cobertura.xml']);

    expect(merged).toMatch(/number="10"[^>]*hits="5"/);
    expect(merged).toMatch(/number="11"[^>]*hits="0"/);
    expect(merged).toMatch(/number="12"[^>]*hits="3"/);
    expect(merged).toContain('filename="src/b.js"');
  });

  it('throws for absolute input paths', async () => {
    await expect(mergeCobertura(['/tmp/coverage.xml'])).rejects.toThrow(/Invalid file path/);
  });

  it('throws for path traversal in input paths', async () => {
    await expect(mergeCobertura(['../coverage.xml'])).rejects.toThrow(/Invalid file path/);
  });

  it('throws when no inputs are provided', async () => {
    await expect(mergeCobertura([])).rejects.toThrow(/No coverage records/);
  });

  it('normalizes absolute Windows-style filenames before merging', async () => {
    const originalWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = 'D:\\a\\repo\\repo';

    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src/a.cs'), '// source\n');
      await writeCoberturaFile(
        tmpDir,
        'windows-1/cobertura.xml',
        `<?xml version="1.0" ?>
<coverage>
  <sources><source>D:/a/repo/repo</source></sources>
  <packages><package name=""><classes>
    <class name="a" filename="D:/a/repo/repo/src/a.cs">
      <lines><line number="1" hits="1" branch="false"/></lines>
    </class>
  </classes></package></packages>
</coverage>
`,
      );
      await writeCoberturaFile(
        tmpDir,
        'windows-2/cobertura.xml',
        `<?xml version="1.0" ?>
<coverage>
  <sources><source>D:/a/repo/repo</source></sources>
  <packages><package name=""><classes>
    <class name="a" filename="D:/a/repo/repo/src/a.cs">
      <lines><line number="1" hits="2" branch="false"/></lines>
    </class>
  </classes></package></packages>
</coverage>
`,
      );

      const merged = await readMerged(['windows-1/cobertura.xml', 'windows-2/cobertura.xml']);
      expect(merged).toContain('filename="src/a.cs"');
      expect(merged).toMatch(/number="1"[^>]*hits="2"/);
      expect(merged).not.toContain('D:/a/repo');
    } finally {
      if (originalWorkspace === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = originalWorkspace;
      }
    }
  });
});
