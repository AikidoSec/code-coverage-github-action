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

  it('exposes path stems for merge grouping without a project file network', () => {
    expect(pathStem('src/widget.js')).toBe('src/widget');
    expect(pathStem('src/widget.d.ts')).toBe('src/widget.d');
    expect(pathStem('src/pkg/handler.py')).toBe('src/pkg/handler');
  });

  it('walks the filesystem and honors hardcoded ignores plus .gitignore', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-'));
    try {
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'node_modules/pkg'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'tmp'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src/app.ts'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, 'node_modules/pkg/index.js'), 'module.exports = {}\n');
      await fs.writeFile(path.join(tmpDir, 'tmp/scratch.js'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, '.gitignore'), 'tmp/\n');

      const project = await loadProjectFiles(tmpDir);
      expect(project.root).toBe(path.resolve(tmpDir));
      expect(project.files).toContain('src/app.ts');
      expect(project.files).not.toContain('.gitignore');
      expect(project.files).not.toContain('node_modules/pkg/index.js');
      expect(project.files).not.toContain('tmp/scratch.js');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('applies nested .gitignore rules under subdirectories', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-files-nested-'));
    try {
      await fs.mkdir(path.join(tmpDir, 'packages/app/src'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'packages/app/generated'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'packages/app/src/a.js'), 'export const a = 1;\n');
      await fs.writeFile(path.join(tmpDir, 'packages/app/generated/out.js'), 'export {}\n');
      await fs.writeFile(path.join(tmpDir, 'packages/app/.gitignore'), 'generated/\n');

      const project = await loadProjectFiles(tmpDir);
      expect(project.files).toContain('packages/app/src/a.js');
      expect(project.files).not.toContain('packages/app/generated/out.js');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('mergeLcov project file integration', () => {
  let tmpDir;
  const mergedDirs = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-lcov-project-'));
  });

  afterEach(async () => {
    for (const dir of mergedDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves paths to project files and drops missing coverage targets', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
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
    await fs.mkdir(path.join(tmpDir, 'packages/app/src'), { recursive: true });
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
