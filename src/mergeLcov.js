// Merge multiple LCOV inputs into one file for upload. Concatenation is not enough:
// monorepos and CI shards often emit separate reports for the same source path (SF:).
// Same SF path → max hits per line. Same path stem with different suffixes → keep the
// primary record's line map only; foreign instrumentation must not change hits or inflate
// LF. When a project file network is available, suffix matching (unmatched paths dropped) and coverage lines past EOF are removed.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPathResolver, loadProjectFiles, pathStem } from './projectFiles.js';
import { applySourceLineFixes, loadSourceLineFixes } from './sourceLineFixes.js';

export async function mergeLcov(paths) {
  const contents = [];

  for (const inputPath of paths) {
    if (inputPath.includes('..') || path.isAbsolute(inputPath)) {
      throw new Error('Invalid file path');
    }

    contents.push(await fs.readFile(path.resolve(inputPath), 'utf8'));
  }

  if (contents.length === 0) {
    throw new Error('No coverage records found in inputs');
  }

  const project = await loadProjectFiles();

  // Project files already map package-relative SF paths (src/a.js → packages/app/src/a.js).
  // Skipping align avoids rewriting those to a wrong first-component root.
  const { sourceRoot, inputsWithoutRootDirectory } = project
    ? { sourceRoot: null, inputsWithoutRootDirectory: null }
    : alignPathRoots(contents);

  const resolveToProjectPath = project ? createPathResolver(project.files) : null;
  const groups = new Map();

  for (const [inputIndex, content] of contents.entries()) {
    for (const record of parseRecords(content, sourceRoot, inputIndex)) {
      let groupKey;
      let projectPath = null;

      if (resolveToProjectPath) {
        projectPath = resolveToProjectPath(record.sourcePath);
        if (!projectPath) {
          continue;
        }

        groupKey = projectPath;
      } else {
        groupKey = pathStem(record.sourcePath);
      }

      const group = groups.get(groupKey) ?? { records: [], projectPath };
      group.records.push(record);
      if (projectPath) {
        group.projectPath = projectPath;
      }

      groups.set(groupKey, group);
    }
  }

  if (groups.size === 0) {
    throw new Error('No coverage records found in inputs');
  }

  const mergedRecords = [];

  for (const { records, projectPath } of groups.values()) {
    const merged = mergeRecordGroup(records, inputsWithoutRootDirectory, projectPath);
    if (project?.root) {
      applySourceLineFixes(merged, await loadSourceLineFixes(project.root, merged.sourcePath));
    }

    if (merged.lines.size > 0 || merged.functions.size > 0 || merged.branches.size > 0) {
      mergedRecords.push(merged);
    }
  }

  if (mergedRecords.length === 0) {
    throw new Error('No coverage records found in inputs');
  }

  const merged = mergedRecords.map(recordToLcov).join('\n');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikido-merged-coverage-'));
  const mergedPath = path.join(tempDir, 'lcov.info');
  await fs.writeFile(mergedPath, merged, 'utf8');

  return mergedPath;
}

function sanitizeSourcePath(sourcePath) {
  const normalized = path.posix.normalize(sourcePath.replace(/\\/g, '/'));

  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Invalid source path in coverage report: ${sourcePath}`);
  }

  const safe = normalized.replace(/^(?:\.\.\/)+/, '').replace(/^\.\//, '');

  if (!safe || safe.includes('..')) {
    throw new Error(`Invalid source path in coverage report: ${sourcePath}`);
  }

  return safe;
}

// One report may use library/foo while another uses foo (different coverage cwd).
// If an entire report is consistently prefixed and another is not, prepend that prefix.
function alignPathRoots(contents) {
  if (contents.length < 2) {
    return { sourceRoot: null, inputsWithoutRootDirectory: null };
  }

  const pathsByFile = contents.map((content) =>
    [...content.matchAll(/^SF:(.+)$/gm)].map((match) => sanitizeSourcePath(match[1])),
  );

  // Find all unique path prefixes.
  const prefixes = new Set();
  for (const paths of pathsByFile) {
    for (const sourcePath of paths) {
      const slash = sourcePath.indexOf('/');
      if (slash > 0) {
        prefixes.add(sourcePath.slice(0, slash));
      }
    }
  }

  let chosenRoot = null;

  for (const prefix of prefixes) {
    const includesRootDirectory = (p) => p === prefix || p.startsWith(`${prefix}/`);

    const inputsWithoutRootDirectory = new Set();
    let someInputIncludesRootDirectory = false;
    let prefixedPathCount = 0;

    for (const [index, paths] of pathsByFile.entries()) {
      if (paths.length === 0) {
        continue;
      }

      if (paths.every(includesRootDirectory)) {
        someInputIncludesRootDirectory = true;
        prefixedPathCount += paths.length;
      } else if (paths.every((p) => !includesRootDirectory(p))) {
        inputsWithoutRootDirectory.add(index);
      }
    }

    if (!someInputIncludesRootDirectory || inputsWithoutRootDirectory.size === 0) {
      continue;
    }

    const shouldChoosePrefix =
      !chosenRoot ||
      prefix.length > chosenRoot.sourceRoot.length ||
      (prefix.length === chosenRoot.sourceRoot.length &&
        prefixedPathCount > chosenRoot.prefixedPathCount);

    if (shouldChoosePrefix) {
      chosenRoot = { sourceRoot: prefix, inputsWithoutRootDirectory, prefixedPathCount };
    }
  }

  if (!chosenRoot) {
    return { sourceRoot: null, inputsWithoutRootDirectory: null };
  }

  return {
    sourceRoot: chosenRoot.sourceRoot,
    inputsWithoutRootDirectory: chosenRoot.inputsWithoutRootDirectory,
  };
}

function withSourceRoot(rawPath, sourceRoot) {
  let sourcePath = sanitizeSourcePath(rawPath);
  if (sourceRoot && !sourcePath.startsWith(`${sourceRoot}/`)) {
    sourcePath = `${sourceRoot}/${sourcePath}`;
  }

  return sourcePath;
}

function createRecord(sourcePath, inputIndex) {
  return { sourcePath, inputIndex, lines: new Map(), functions: new Map(), branches: new Map() };
}

function parseRecords(content, sourceRoot, inputIndex) {
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

function countLinesHit(record) {
  let linesHit = 0;
  for (const hits of record.lines.values()) {
    if (hits > 0) {
      linesHit++;
    }
  }

  return linesHit;
}

function mergeMaxBranch(prev, taken) {
  if (taken === '-' && (prev === undefined || prev === '-')) {
    return '-';
  }

  const prevHits = prev === undefined || prev === '-' ? 0 : prev;
  const newHits = taken === '-' ? 0 : taken;
  return Math.max(prevHits, newHits);
}

// Full union (same SF path / CI shards).
function mergeSamePathHits(target, source) {
  for (const [lineNo, hits] of source.lines) {
    target.lines.set(lineNo, Math.max(target.lines.get(lineNo) || 0, hits));
  }

  for (const [name, { line, hits }] of source.functions) {
    const prev = target.functions.get(name) || { line: 0, hits: 0 };
    target.functions.set(name, {
      line: line || prev.line,
      hits: Math.max(prev.hits, hits),
    });
  }

  for (const [key, taken] of source.branches) {
    target.branches.set(key, mergeMaxBranch(target.branches.get(key), taken));
  }
}

// Prefer: report without root directory, then densest coverage.
function pickPrimaryRecord(records, inputsWithoutRootDirectory) {
  return records.sort((left, right) => {
    if (inputsWithoutRootDirectory) {
      const leftOmitsRootDirectory = inputsWithoutRootDirectory.has(left.inputIndex);
      const rightOmitsRootDirectory = inputsWithoutRootDirectory.has(right.inputIndex);
      if (leftOmitsRootDirectory !== rightOmitsRootDirectory) {
        return leftOmitsRootDirectory ? -1 : 1;
      }
    }

    const lineDiff = right.lines.size - left.lines.size;
    if (lineDiff !== 0) {
      return lineDiff;
    }

    const hitDiff = countLinesHit(right) - countLinesHit(left);
    if (hitDiff !== 0) {
      return hitDiff;
    }

    return left.sourcePath.localeCompare(right.sourcePath);
  })[0];
}

function mergeRecordGroup(records, inputsWithoutRootDirectory, projectPath = null) {
  const byPath = new Map();

  for (const record of records) {
    const existing = byPath.get(record.sourcePath);
    if (existing) {
      mergeSamePathHits(existing, record);
      continue;
    }

    const copy = createRecord(record.sourcePath, record.inputIndex);
    mergeSamePathHits(copy, record);
    byPath.set(record.sourcePath, copy);
  }

  const pathRecords = [...byPath.values()];

  // Same project file under different SF spellings (e.g. src/a.js vs
  // packages/app/src/a.js) — union hits; line numbers refer to one source tree.
  if (projectPath) {
    const merged = createRecord(projectPath, pathRecords[0].inputIndex);
    for (const record of pathRecords) {
      mergeSamePathHits(merged, record);
    }

    return merged;
  }

  const primary = pickPrimaryRecord(pathRecords, inputsWithoutRootDirectory);
  const merged = createRecord(primary.sourcePath, primary.inputIndex);

  mergeSamePathHits(merged, primary);

  // Different suffix (e.g. .js vs .ts): keep primary line map only — do not overlay
  // foreign hits; line numbers are not comparable across instrumentations.
  return merged;
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

function mergeBranchHit(record, value) {
  const [lineNo, block, branch, taken] = value.split(',');
  const key = `${lineNo}\0${block}\0${branch}`;
  const hit = taken === '-' ? '-' : Number(taken);

  record.branches.set(key, mergeMaxBranch(record.branches.get(key), hit));
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
