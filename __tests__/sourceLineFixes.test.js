import { applySourceLineFixes, loadSourceLineFixes } from '../src/sourceLineFixes.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('sourceLineFixes', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-fixes-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports eof for any source language without content-based ignores', async () => {
    const source = ['function x() {', '  return 1;', '}', '', '// done', ''].join('\n');
    await fs.writeFile(path.join(tmpDir, 'mod.js'), source);
    await fs.writeFile(path.join(tmpDir, 'mod.go'), source);
    await fs.writeFile(path.join(tmpDir, 'mod.py'), source);

    for (const relativePath of ['mod.js', 'mod.go', 'mod.py']) {
      const fixes = await loadSourceLineFixes(tmpDir, relativePath);
      expect(fixes.eof).toBe(6);
      expect(fixes.ignored).toBeUndefined();
    }
  });

  it('returns null when the source file is missing', async () => {
    expect(await loadSourceLineFixes(tmpDir, 'missing.ts')).toBeNull();
  });

  it('returns null for a tracked symlink instead of following it', async () => {
    const linkPath = path.join(tmpDir, 'generated.js');
    await fs.symlink('/dev/null', linkPath);

    expect(await loadSourceLineFixes(tmpDir, 'generated.js')).toBeNull();
  });

  it('drops DA, FN, and BRDA entries past eof', () => {
    const record = {
      sourcePath: 'mod.go',
      inputIndex: 0,
      lines: new Map([
        [1, 1],
        [2, 0],
        [3, 1],
        [9, 1],
      ]),
      functions: new Map([['x', { line: 9, hits: 1 }]]),
      branches: new Map([
        ['2\0\0\0', 1],
        ['9\0\0\0', 1],
      ]),
    };

    applySourceLineFixes(record, { eof: 3 });

    expect([...record.lines.keys()]).toEqual([1, 2, 3]);
    expect(record.functions.size).toBe(0);
    expect([...record.branches.keys()]).toEqual(['2\0\0\0']);
  });
});
