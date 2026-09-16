import { mergeCoverageFiles, createRecord, sanitizeSourcePath, withSourceRoot } from '../merge.js';
import { normalizeSourcePath } from '../paths.js';

export function normalizeLcovSourcePaths(content, repositoryRoot) {
  return content.replace(
    /^SF:([^\r\n]*)/gm,
    (_directive, sourcePath) => `SF:${normalizeSourcePath(sourcePath, repositoryRoot)}`,
  );
}

function extractLcovFilenames(content) {
  return [...content.matchAll(/^SF:(.+)$/gm)].map((match) => sanitizeSourcePath(match[1]));
}

function parseLcovRecords(content, { sourceRoot, inputIndex }) {
  const records = [];
  let record = null;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }

    if (line === 'end_of_record') {
      if (record) {
        records.push(record);
      }

      record = null;
      continue;
    }

    const colon = line.indexOf(':');
    const tag = colon === -1 ? '' : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1);

    if (tag === 'SF') {
      record = createRecord(withSourceRoot(value, sourceRoot), inputIndex);
      continue;
    }

    if (!record) {
      continue;
    }

    if (tag === 'DA') {
      mergeLineHit(record, value);
    } else if (tag === 'FN') {
      mergeFunctionDefinition(record, value);
    } else if (tag === 'FNDA') {
      mergeFunctionHit(record, value);
    } else if (tag === 'BRDA') {
      mergeBranchHit(record, value);
    }
  }

  return records;
}

function mergeLineHit(record, value) {
  const [lineNo, hits] = value.split(',');
  const n = Number(lineNo);
  const hitCount = Number(hits);
  record.lines.set(n, Math.max(record.lines.get(n) || 0, hitCount));
}

function mergeFunctionDefinition(record, value) {
  const comma = value.indexOf(',');
  const line = Number(value.slice(0, comma));
  const name = value.slice(comma + 1);
  const prev = record.functions.get(name) || { line: 0, hits: 0 };
  record.functions.set(name, { line, hits: prev.hits });
}

function mergeFunctionHit(record, value) {
  const comma = value.indexOf(',');
  const hits = Number(value.slice(0, comma));
  const name = value.slice(comma + 1);
  const prev = record.functions.get(name) || { line: 0, hits: 0 };
  record.functions.set(name, { line: prev.line, hits: Math.max(prev.hits, hits) });
}

function mergeMaxBranch(prev, taken) {
  if (taken === '-' && (prev === undefined || prev === '-')) {
    return '-';
  }

  const prevHits = prev === undefined || prev === '-' ? 0 : prev;
  const newHits = taken === '-' ? 0 : taken;
  return Math.max(prevHits, newHits);
}

function mergeBranchHit(record, value) {
  const [lineNo, block, branch, taken] = value.split(',');
  const key = `${lineNo}\0${block}\0${branch}`;
  const hit = taken === '-' ? '-' : Number(taken);
  record.branches.set(key, mergeMaxBranch(record.branches.get(key), hit));
}

function serializeLcovRecords(records) {
  return records.map(recordToLcov).join('\n');
}

function recordToLcov(coverage) {
  const lines = [`SF:${coverage.sourcePath}`];

  for (const [name, { line }] of coverage.functions) {
    lines.push(`FN:${line},${name}`);
  }

  let functionsHit = 0;
  for (const [name, { hits }] of coverage.functions) {
    lines.push(`FNDA:${hits},${name}`);
    if (hits > 0) {
      functionsHit++;
    }
  }

  if (coverage.functions.size > 0) {
    lines.push(`FNF:${coverage.functions.size}`, `FNH:${functionsHit}`);
  }

  for (const key of [...coverage.branches.keys()].sort()) {
    const [lineNo, block, branch] = key.split('\0');
    lines.push(`BRDA:${lineNo},${block},${branch},${coverage.branches.get(key)}`);
  }

  if (coverage.branches.size > 0) {
    const branchesHit = [...coverage.branches.values()].filter((v) => v !== '-' && v > 0).length;
    lines.push(`BRF:${coverage.branches.size}`, `BRH:${branchesHit}`);
  }

  let linesHit = 0;
  for (const lineNo of [...coverage.lines.keys()].sort((a, b) => a - b)) {
    const hits = coverage.lines.get(lineNo);
    lines.push(`DA:${lineNo},${hits}`);
    if (hits > 0) {
      linesHit++;
    }
  }

  lines.push(`LF:${coverage.lines.size}`, `LH:${linesHit}`, 'end_of_record');
  return lines.join('\n');
}

export async function mergeLcov(paths) {
  return mergeCoverageFiles({
    paths,
    normalizeContent: normalizeLcovSourcePaths,
    extractFilenames: extractLcovFilenames,
    parseRecords: parseLcovRecords,
    serialize: serializeLcovRecords,
    outputFilename: 'lcov.info',
  });
}
