import { XMLParser } from 'fast-xml-parser';
import XMLBuilder from 'fast-xml-builder';
import { isAbsoluteSourcePath, normalizeSourcePath } from '../paths.js';
import { mergeCoverageFiles, createRecord, sanitizeSourcePath, withSourceRoot } from '../merge.js';

const ARRAY_TAGS = new Set(['source', 'package', 'class', 'method', 'line', 'condition']);

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
};

const parser = new XMLParser({
  ...XML_OPTIONS,
  isArray: (name) => ARRAY_TAGS.has(name),
});

/** Rewrite class filenames to repo-relative paths and reset sources to ".". */
export function normalizeCoberturaSourcePaths(content, repositoryRoot) {
  const parsed = parser.parse(content);
  normalizeCoberturaFileTree(parsed?.coverage, repositoryRoot);

  return serializeCoberturaDocument(parsed);
}

function normalizeCoberturaFileTree(coverage, repositoryRoot) {
  if (!coverage) {
    throw new Error('Invalid Cobertura report: missing <coverage> root');
  }

  const sourceRoots = collectSourceRoots(coverage);

  walkClasses(coverage, (classNode) => {
    classNode['@_filename'] = resolveClassFilename(
      classNode['@_filename'],
      sourceRoots,
      repositoryRoot,
    );
  });

  if (coverage.sources) {
    coverage.sources = { source: ['.'] };
  }

  return coverage;
}

function serializeCoberturaDocument(document) {
  const xml = new XMLBuilder({
    ...XML_OPTIONS,
    format: true,
    suppressEmptyNode: true,
  }).build(document);

  return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" ?>\n${xml}`;
}

function collectSourceRoots(coverageNode) {
  const entries = coverageNode?.sources?.source ?? [];

  return entries
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }

      if (entry?.['#text']) {
        return String(entry['#text']).trim();
      }

      return '';
    })
    .filter(Boolean);
}

function walkClasses(coverageNode, callback) {
  for (const pkg of coverageNode?.packages?.package ?? []) {
    for (const classNode of pkg?.classes?.class ?? []) {
      callback(classNode, pkg);
    }
  }
}

function resolveClassFilename(filename, sourceRoots, repositoryRoot) {
  const name = (filename || '').trim();
  if (!name) {
    throw new Error('Cobertura class is missing a filename attribute');
  }

  const candidates = isAbsoluteSourcePath(name)
    ? [name]
    : [
        ...sourceRoots
          .map((root) => root.replaceAll('\\', '/').replace(/\/+$/, ''))
          .filter((root) => root && root !== '.')
          .map((root) => `${root}/${name}`),
        name,
      ];

  for (const candidate of candidates) {
    try {
      return normalizeSourcePath(candidate, repositoryRoot).replace(/^\.\//, '');
    } catch {
      throw new Error(`Invalid source path outside the repository: ${candidate}`);
    }
  }

  throw new Error(`Invalid source path outside the repository: ${filename}`);
}

export async function mergeCobertura(paths) {
  return mergeCoverageFiles({
    paths,
    normalizeContent: normalizeCoberturaSourcePaths,
    extractFilenames: extractCoberturaFilenames,
    parseRecords: parseCoberturaRecords,
    serialize: serializeCoberturaRecords,
    outputFilename: 'cobertura.xml',
  });
}

function extractCoberturaFilenames(content) {
  const coverage = parser.parse(content)?.coverage;
  const filenames = [];
  walkClasses(coverage, (classNode) => {
    const filename = classNode['@_filename'];
    if (filename) {
      filenames.push(sanitizeSourcePath(filename));
    }
  });
  return filenames;
}

function parseCoberturaRecords(content, { sourceRoot, inputIndex }) {
  const coverage = parser.parse(content)?.coverage;
  const records = [];

  walkClasses(coverage, (classNode) => {
    const filename = classNode['@_filename'] || '';
    const className = classNode['@_name'] || filename;
    const record = createRecord(withSourceRoot(filename, sourceRoot), inputIndex, className);

    for (const lineNode of classNode.lines?.line ?? []) {
      const number = Number(lineNode['@_number']);
      const hits = Number(lineNode['@_hits'] ?? 0);
      if (!Number.isFinite(number)) {
        continue;
      }

      record.lines.set(number, Math.max(record.lines.get(number) || 0, hits));
    }

    // Some generators only put hits under <methods>; fold those into the class line map.
    for (const methodNode of classNode.methods?.method ?? []) {
      for (const lineNode of methodNode.lines?.line ?? []) {
        const number = Number(lineNode['@_number']);
        const hits = Number(lineNode['@_hits'] ?? 0);
        if (!Number.isFinite(number)) {
          continue;
        }

        record.lines.set(number, Math.max(record.lines.get(number) || 0, hits));
      }
    }

    records.push(record);
  });

  return records;
}

function serializeCoberturaRecords(records) {
  let linesValid = 0;
  let linesCovered = 0;

  const classes = records.map((record) => {
    linesValid += record.lines.size;
    let hitCount = 0;
    for (const hits of record.lines.values()) {
      if (hits > 0) {
        hitCount++;
        linesCovered++;
      }
    }

    const sortedLines = [...record.lines.keys()].sort((a, b) => a - b);
    const lineNodes = sortedLines.map((lineNo) => ({
      '@_number': String(lineNo),
      '@_hits': String(record.lines.get(lineNo)),
      '@_branch': 'false',
    }));

    const lineRate = record.lines.size === 0 ? '0' : (hitCount / record.lines.size).toFixed(4);

    return {
      '@_name': record.className || record.sourcePath,
      '@_filename': record.sourcePath,
      '@_line-rate': lineRate,
      '@_branch-rate': '0',
      lines: { line: lineNodes },
    };
  });

  const lineRateValue = linesValid === 0 ? '0' : (linesCovered / linesValid).toFixed(4);

  return serializeCoberturaDocument({
    coverage: {
      '@_line-rate': lineRateValue,
      '@_branch-rate': '0',
      '@_lines-covered': String(linesCovered),
      '@_lines-valid': String(linesValid),
      '@_branches-covered': '0',
      '@_branches-valid': '0',
      '@_timestamp': String(Date.now()),
      '@_version': 'aikido-merge',
      sources: { source: ['.'] },
      packages: {
        package: [
          {
            '@_name': '',
            '@_line-rate': lineRateValue,
            '@_branch-rate': '0',
            classes: { class: classes },
          },
        ],
      },
    },
  });
}
