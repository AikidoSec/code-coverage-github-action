import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveLcovFilePaths } from '../src/resolveLcovFilePaths.js';

describe('resolveLcovFilePaths', () => {
  let tmpDir;
  let previousCwd;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-lcov-'));
    previousCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves a literal path', async () => {
    await fs.writeFile('lcov.info', '');

    const resolved = await resolveLcovFilePaths(['lcov.info']);

    expect(resolved).toEqual([path.join(tmpDir, 'lcov.info')]);
  });

  it('expands a glob pattern to every matching file', async () => {
    await fs.mkdir('packages/a/coverage', { recursive: true });
    await fs.mkdir('packages/b/coverage', { recursive: true });
    await fs.writeFile('packages/a/coverage/lcov.info', '');
    await fs.writeFile('packages/b/coverage/lcov.info', '');

    const resolved = await resolveLcovFilePaths(['packages/*/coverage/lcov.info']);

    expect(resolved.sort()).toEqual(
      [
        path.join(tmpDir, 'packages/a/coverage/lcov.info'),
        path.join(tmpDir, 'packages/b/coverage/lcov.info'),
      ].sort(),
    );
  });

  it('deduplicates files matched by overlapping patterns', async () => {
    await fs.mkdir('coverage', { recursive: true });
    await fs.writeFile('coverage/lcov.info', '');

    const resolved = await resolveLcovFilePaths(['coverage/lcov.info', 'coverage/*.info']);

    expect(resolved).toEqual([path.join(tmpDir, 'coverage/lcov.info')]);
  });

  it('throws when a pattern matches no files', async () => {
    await expect(resolveLcovFilePaths(['packages/*/coverage/lcov.info'])).rejects.toThrow(
      /No file\(s\) found matching "packages\/\*\/coverage\/lcov.info"/,
    );
  });

  it('rejects an absolute pattern', async () => {
    await expect(resolveLcovFilePaths(['/etc/passwd'])).rejects.toThrow(
      /Invalid file path: absolute paths and "\.\." segments are not allowed/,
    );
  });

  it('rejects a pattern containing ".." segments', async () => {
    await expect(resolveLcovFilePaths(['../etc/passwd'])).rejects.toThrow(
      /Invalid file path: absolute paths and "\.\." segments are not allowed/,
    );
  });

  it('rejects a matched file that is a symlink outside the workspace', async () => {
    const secret = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-lcov-secret-'));
    await fs.writeFile(path.join(secret, 'passwd'), 'root:x:0:0');
    await fs.symlink(path.join(secret, 'passwd'), 'coverage.info');

    try {
      await expect(resolveLcovFilePaths(['coverage.info'])).rejects.toThrow(
        /matched a symlink, which is not allowed/,
      );
    } finally {
      await fs.rm(secret, { recursive: true, force: true });
    }
  });
});
