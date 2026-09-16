import { normalizeCoberturaSourcePaths } from '../src/formats/cobertura.js';

describe('normalizeCoberturaSourcePaths', () => {
  it('rewrites absolute class filenames to repository-relative paths', () => {
    const xml = `<?xml version="1.0" ?>
<coverage line-rate="1" branch-rate="1">
  <sources>
    <source>/repo</source>
  </sources>
  <packages>
    <package name="">
      <classes>
        <class name="a" filename="/repo/src/a.js" line-rate="1" branch-rate="1">
          <lines>
            <line number="1" hits="1" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;

    const normalized = normalizeCoberturaSourcePaths(xml, '/repo');
    expect(normalized).toContain('filename="src/a.js"');
    expect(normalized).not.toContain('filename="/repo/src/a.js"');
    expect(normalized).not.toContain('filename="repo/src/a.js"');
    expect(normalized).toContain('<source>.</source>');
  });

  it('does not prefix relative filenames with a "." source root', () => {
    const xml = `<?xml version="1.0" ?>
<coverage line-rate="1" branch-rate="1">
  <sources>
    <source>.</source>
  </sources>
  <packages>
    <package name="">
      <classes>
        <class name="a" filename="src/a.js" line-rate="1" branch-rate="1">
          <lines>
            <line number="1" hits="1" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;

    const normalized = normalizeCoberturaSourcePaths(xml, '/repo');
    expect(normalized).toContain('filename="src/a.js"');
    expect(normalized).not.toContain('filename="./src/a.js"');
  });

  it('joins source root with relative class filenames', () => {
    const xml = `<?xml version="1.0" ?>
<coverage line-rate="1" branch-rate="1">
  <sources>
    <source>/repo</source>
  </sources>
  <packages>
    <package name="">
      <classes>
        <class name="a" filename="src/a.js" line-rate="1" branch-rate="1">
          <lines>
            <line number="1" hits="2" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;

    const normalized = normalizeCoberturaSourcePaths(xml, '/repo');
    expect(normalized).toContain('filename="src/a.js"');
  });

  it('throws for reports without a coverage root', () => {
    expect(() => normalizeCoberturaSourcePaths('<not-coverage/>', '/repo')).toThrow(
      /missing <coverage>/,
    );
  });
});
