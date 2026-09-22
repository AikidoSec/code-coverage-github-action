import { detectFormatFromFilename, extractCoveredSourcePaths } from '../src/reportPaths.js';

describe('reportPaths', () => {
  describe('detectFormatFromFilename', () => {
    it('detects lcov from filename', () => {
      expect(detectFormatFromFilename('coverage/lcov.info')).toBe('lcov');
      expect(detectFormatFromFilename('out.lcov')).toBe('lcov');
      expect(detectFormatFromFilename('coverage\\lcov.info')).toBe('lcov');
    });

    it('detects cobertura from filename', () => {
      expect(detectFormatFromFilename('cobertura.xml')).toBe('cobertura');
      expect(detectFormatFromFilename('coverage/coverage.xml')).toBe('cobertura');
    });

    it('throws when format cannot be detected', () => {
      expect(() => detectFormatFromFilename('report.txt')).toThrow(/Could not detect coverage format/);
    });
  });

  describe('extractCoveredSourcePaths', () => {
    const root = '/repo';

    it('extracts LCOV SF paths', () => {
      expect(
        extractCoveredSourcePaths(
          'SF:src/a.js\nDA:1,1\nend_of_record\nSF:src/b.js\nend_of_record\n',
          'lcov',
          root,
        ),
      ).toEqual(['src/a.js', 'src/b.js']);
    });

    it('relativizes absolute LCOV paths against the repository root', () => {
      expect(
        extractCoveredSourcePaths(`SF:${root}/src/a.js\nend_of_record\n`, 'lcov', root),
      ).toEqual(['src/a.js']);
    });

    it('extracts Cobertura filenames', () => {
      const xml = `<class name="a" filename="src/a.js"><lines/></class>`;
      expect(extractCoveredSourcePaths(xml, 'cobertura', root)).toEqual(['src/a.js']);
    });
  });
});
