import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPathResolver, pathStem } from '../src/gitTrackedFiles.js';

const execFileAsync = promisify(execFile);

async function initGitRepo(dir, trackedFiles) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  await execFileAsync('git', ['init'], { cwd: dir });

  for (const filePath of trackedFiles) {
    const absolute = path.join(dir, filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, 'export {}\n');
  }

  await execFileAsync('git', ['add', ...trackedFiles], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir, env });
}

describe('gitTrackedFiles', () => {
  it('resolves coverage paths to git files by path suffix', () => {
    const resolve = createPathResolver([
      'library/agent/Agent.ts',
      'library/helpers/foo.ts',
      'src/pkg/handler.py',
      'cmd/server/main.go',
    ]);

    expect(resolve('library/agent/Agent.ts')).toBe('library/agent/Agent.ts');
    expect(resolve('agent/Agent.ts')).toBe('library/agent/Agent.ts');
    expect(resolve('pkg/handler.py')).toBe('src/pkg/handler.py');
    expect(resolve('server/main.go')).toBe('cmd/server/main.go');
    expect(resolve('library/helpers/generated/urlencoded.js')).toBeNull();
  });

  it('does not remap a different file extension onto a git path', () => {
    const resolve = createPathResolver([
      'library/agent/Agent.ts',
      'library/agent/hooks/instrumentation/injectedFunctions.mjs',
      'library/agent/hooks/instrumentation/injectedFunctions.ts',
    ]);

    expect(resolve('library/agent/Agent.js')).toBeNull();
    expect(resolve('library/agent/hooks/instrumentation/injectedFunctions.js')).toBeNull();
    expect(resolve('agent/hooks/instrumentation/injectedFunctions.ts')).toBe(
      'library/agent/hooks/instrumentation/injectedFunctions.ts',
    );
    expect(resolve('agent/hooks/instrumentation/injectedFunctions.mjs')).toBe(
      'library/agent/hooks/instrumentation/injectedFunctions.mjs',
    );
  });

  it('picks the best match when the same basename exists in multiple directories', () => {
    const resolve = createPathResolver(['packages/a/index.ts', 'packages/b/index.ts']);

    expect(resolve('packages/a/index.ts')).toBe('packages/a/index.ts');
    expect(resolve('a/index.ts')).toBe('packages/a/index.ts');
  });

  it('exposes path stems for non-git merge grouping', () => {
    expect(pathStem('src/widget.js')).toBe('src/widget');
    expect(pathStem('src/widget.d.ts')).toBe('src/widget.d');
    expect(pathStem('src/pkg/handler.py')).toBe('src/pkg/handler');
  });
});

describe('mergeLcov git integration', () => {
  let tmpDir;
  const mergedDirs = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-lcov-git-'));
  });

  afterEach(async () => {
    for (const dir of mergedDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves paths to git files and drops untracked coverage', async () => {
    await initGitRepo(tmpDir, ['src/app.ts']);
    await fs.writeFile(
      path.join(tmpDir, 'src/app.ts'),
      'export const a = 1;\nexport const b = 2;\n',
    );

    const job1 = `SF:src/app.ts
DA:1,1
DA:2,0
DA:9,5
end_of_record
`;
    const job2 = `SF:src/generated.js
DA:1,1
end_of_record
`;

    await fs.writeFile(path.join(tmpDir, 'job1.lcov'), job1);
    await fs.writeFile(path.join(tmpDir, 'job2.lcov'), job2);

    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { mergeLcov } = await import('../src/mergeLcov.js');
      const mergedPath = await mergeLcov(['job1.lcov', 'job2.lcov']);
      mergedDirs.push(path.dirname(mergedPath));
      const merged = await fs.readFile(mergedPath, 'utf8');

      expect(merged.match(/^SF:/gm)).toHaveLength(1);
      expect(merged).toContain('SF:src/app.ts');
      expect(merged).toContain('DA:1,1');
      expect(merged).toContain('DA:2,0');
      expect(merged).not.toContain('DA:9,5');
      expect(merged).not.toContain('generated');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('keeps package-relative coverage when another report uses a monorepo packages/ prefix', async () => {
    await initGitRepo(tmpDir, ['packages/app/src/a.js']);
    await fs.writeFile(path.join(tmpDir, 'packages/app/src/a.js'), 'export const a = 1;\n');

    const job1 = `SF:packages/app/src/a.js
DA:1,1
end_of_record
`;
    const job2 = `SF:src/a.js
DA:1,3
end_of_record
`;

    await fs.writeFile(path.join(tmpDir, 'job1.lcov'), job1);
    await fs.writeFile(path.join(tmpDir, 'job2.lcov'), job2);

    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { mergeLcov } = await import('../src/mergeLcov.js');
      const mergedPath = await mergeLcov(['job1.lcov', 'job2.lcov']);
      mergedDirs.push(path.dirname(mergedPath));
      const merged = await fs.readFile(mergedPath, 'utf8');

      expect(merged.match(/^SF:/gm)).toHaveLength(1);
      expect(merged).toContain('SF:packages/app/src/a.js');
      expect(merged).toContain('DA:1,3');
      expect(merged).not.toContain('SF:packages/src/a.js');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
