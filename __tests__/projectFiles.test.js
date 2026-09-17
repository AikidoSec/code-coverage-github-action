import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPathResolver, loadProjectFiles, pathStem } from '../src/projectFiles.js';

describe('projectFiles', () => {
  it('resolves coverage paths to project files by path suffix', () => {
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

  it('does not remap a different file extension onto a project path', () => {
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

  it('resolves absolute coverage paths that end with a project path', () => {
    const resolve = createPathResolver(['src/app.ts', 'lib/util.js']);

    expect(resolve('/Users/me/repo/src/app.ts')).toBe('src/app.ts');
    expect(resolve('C:\\Users\\me\\repo\\lib\\util.js')).toBe('lib/util.js');
  });

  it('exposes path stems for merge grouping without a project file network', () => {
    expect(pathStem('src/widget.js')).toBe('src/widget');
    expect(pathStem('src/widget.d.ts')).toBe('src/widget.d');
    expect(pathStem('src/pkg/handler.py')).toBe('src/pkg/handler');
  });

  it('picks the shorter path when trailing segments tie', () => {
    const resolve = createPathResolver([
      'apps/web/src/util.js',
      'packages/core/src/util.js',
      'src/util.js',
    ]);

    expect(resolve('src/util.js')).toBe('src/util.js');
  });

  it('returns null when multiple candidates are equally good matches', () => {
    const resolve = createPathResolver(['x/pkg/util.js', 'y/pkg/util.js']);

    // Ambiguous remap would silently attach coverage to the wrong package.
    expect(resolve('pkg/util.js')).toBeNull();
  });

  it('prefers the candidate with more shared trailing segments', () => {
    const resolve = createPathResolver(['packages/a/src/util.js', 'packages/b/lib/util.js']);

    expect(resolve('a/src/util.js')).toBe('packages/a/src/util.js');
  });

  it('normalizes leading ./ and backslashes before resolving', () => {
    const resolve = createPathResolver(['src/app.ts']);

    expect(resolve('./src/app.ts')).toBe('src/app.ts');
    expect(resolve('src\\app.ts')).toBe('src/app.ts');
  });

  it('filters coverage artifacts out of the project file list', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-artifacts-'));
    const previousCwd = process.cwd();
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src/app.js'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, 'coverage.lcov'), 'SF:src/app.js\nend_of_record\n');
      await fs.writeFile(path.join(tmpDir, 'lcov.info'), 'SF:src/app.js\nend_of_record\n');
      await fs.writeFile(path.join(tmpDir, 'coverage-final.json'), '{}\n');
      await fs.writeFile(path.join(tmpDir, 'clover.xml'), '<coverage/>\n');
      await fs.writeFile(path.join(tmpDir, 'cobertura.xml'), '<coverage/>\n');

      process.chdir(tmpDir);
      const project = await loadProjectFiles();
      expect(project.files).toEqual(['src/app.js']);
    } finally {
      process.chdir(previousCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips directories that cannot be read while walking', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-unreadable-'));
    const previousCwd = process.cwd();
    const blocked = path.join(tmpDir, 'blocked');
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.mkdir(blocked, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src/app.js'), 'export {}\n');
      await fs.writeFile(path.join(blocked, 'secret.js'), 'export {}\n');
      await fs.chmod(blocked, 0o000);

      process.chdir(tmpDir);
      const project = await loadProjectFiles();
      expect(project.files).toContain('src/app.js');
      expect(project.files).not.toContain('blocked/secret.js');
    } finally {
      await fs.chmod(blocked, 0o755).catch(() => {});
      process.chdir(previousCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('walks the filesystem and honors hardcoded ignores plus .gitignore', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-'));
    const previousCwd = process.cwd();
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'node_modules/pkg'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'tmp'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src/app.ts'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, 'node_modules/pkg/index.js'), 'module.exports = {}\n');
      await fs.writeFile(path.join(tmpDir, 'tmp/scratch.js'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, '.gitignore'), 'tmp/\n');

      process.chdir(tmpDir);
      const project = await loadProjectFiles();
      expect(project.root).toBe(await fs.realpath(tmpDir));
      expect(project.files).toContain('src/app.ts');
      expect(project.files).not.toContain('.gitignore');
      expect(project.files).not.toContain('node_modules/pkg/index.js');
      expect(project.files).not.toContain('tmp/scratch.js');
    } finally {
      process.chdir(previousCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('walks up from a nested cwd to the repository root', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-nested-cwd-'));
    const previousCwd = process.cwd();
    try {
      await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'packages/a/src'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'packages/b/src'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'packages/a/src/index.js'), 'export const a = 1;\n');
      await fs.writeFile(path.join(tmpDir, 'packages/b/src/index.js'), 'export const b = 1;\n');

      process.chdir(path.join(tmpDir, 'packages/b'));
      const project = await loadProjectFiles();
      expect(project.root).toBe(await fs.realpath(tmpDir));
      expect(project.files).toEqual(
        expect.arrayContaining(['packages/a/src/index.js', 'packages/b/src/index.js']),
      );
    } finally {
      process.chdir(previousCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('applies nested .gitignore rules under subdirectories', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-nested-'));
    const previousCwd = process.cwd();
    try {
      await fs.mkdir(path.join(tmpDir, 'packages/app/src'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'packages/app/generated'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'packages/app/src/a.js'), 'export const a = 1;\n');
      await fs.writeFile(path.join(tmpDir, 'packages/app/generated/out.js'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, 'packages/app/.gitignore'), 'generated/\n');

      process.chdir(tmpDir);
      const project = await loadProjectFiles();
      expect(project.files).toContain('packages/app/src/a.js');
      expect(project.files).not.toContain('packages/app/generated/out.js');
    } finally {
      process.chdir(previousCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors nested .gitignore negations that re-include parent-ignored files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-negate-'));
    const previousCwd = process.cwd();
    try {
      await fs.mkdir(path.join(tmpDir, 'sub'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'sub/keep.log'), 'keep\n');
      await fs.writeFile(path.join(tmpDir, 'sub/other.log'), 'drop\n');
      await fs.writeFile(path.join(tmpDir, 'sub/app.js'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, '.gitignore'), '*.log\n');
      await fs.writeFile(path.join(tmpDir, 'sub/.gitignore'), '!keep.log\n');

      process.chdir(tmpDir);
      const project = await loadProjectFiles();
      expect(project.files).toContain('sub/keep.log');
      expect(project.files).toContain('sub/app.js');
      expect(project.files).not.toContain('sub/other.log');
    } finally {
      process.chdir(previousCwd);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
