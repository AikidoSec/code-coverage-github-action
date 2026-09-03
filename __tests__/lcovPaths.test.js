import { normalizeLcovSourcePaths, normalizeSourcePath } from '../src/lcovPaths.js';

describe('LCOV source path normalization', () => {
  it('makes a Windows runner path repository-relative', () => {
    expect(
      normalizeSourcePath(
        'D:\\a\\some-path\\some-other-path\\some-file.cs',
        'D:\\a\\some-path\\some-other-path',
      ),
    ).toBe('some-file.cs');
  });

  it('matches Windows drive and repository paths case-insensitively', () => {
    expect(normalizeSourcePath('d:\\A\\Repo\\Repo\\src\\File.cs', 'D:\\a\\repo\\repo')).toBe(
      'src/File.cs',
    );
  });

  it('makes a Unix runner path repository-relative', () => {
    expect(
      normalizeSourcePath(
        '/home/runner/work/some-path/some-other-path/src/some-file.rs',
        '/home/runner/work/some-path/some-other-path',
      ),
    ).toBe('src/some-file.rs');
  });

  it('preserves relative LCOV content except for Windows separators', () => {
    const content = 'TN:\nSF:src/app.js\nDA:1,1\nend_of_record\nSF:src\\other.js\nend_of_record\n';

    expect(normalizeLcovSourcePaths(content, '/repo')).toBe(
      'TN:\nSF:src/app.js\nDA:1,1\nend_of_record\nSF:src/other.js\nend_of_record\n',
    );
  });

  it('rejects absolute paths outside the repository', () => {
    expect(() => normalizeSourcePath('/tmp/other/file.js', '/repo')).toThrow(
      /outside the repository/,
    );
    expect(() => normalizeSourcePath('C:\\other\\file.cs', 'D:\\a\\repo\\repo')).toThrow(
      /outside the repository/,
    );
    expect(() => normalizeSourcePath('/Repo/src/file.js', '/repo')).toThrow(
      /outside the repository/,
    );
  });
});
