// Merge multiple coverage inputs into one file for upload. Concatenation is not
// enough: monorepos and CI shards often emit separate reports for the same source
// path. Same path → max hits per line. Same path stem with different suffixes →
// keep the primary record's line map only. When a project file index is available,
// suffix matching (unmatched paths dropped) and coverage lines past EOF are removed.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPathResolver, loadProjectFiles, pathStem } from './projectFiles.js';
import { applySourceLineFixes, loadSourceLineFixes } from './sourceLineFixes.js';

/**
 * Canonical coverage record used by the shared merger.
 * Format parsers convert into this shape; serializers convert back out.
 */
export function createRecord(sourcePath, inputIndex, className = sourcePath) {
  return {
    sourcePath,
    inputIndex,
    className,
    lines: new Map(),
    functions: new Map(),
    branches: new Map(),
  };
}

export function sanitizeSourcePath(sourcePath) {
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

export function withSourceRoot(rawPath, sourceRoot) {
  let sourcePath = sanitizeSourcePath(rawPath);
  if (sourceRoot && !sourcePath.startsWith(`${sourceRoot}/`)) {
    sourcePath = `${sourceRoot}/${sourcePath}`;
  }

  return sourcePath;
}

/**
 * One report may use library/foo while another uses foo (different coverage cwd).
 * If an entire report is consistently prefixed and another is not, prepend that prefix.
 */
export function alignPathRoots(pathsByFile) {
  if (pathsByFile.length < 2) {
    return { sourceRoot: null, inputsWithoutRootDirectory: null };
  }

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

/** Full union (same source path / CI shards). */
export function mergeSamePathHits(target, source) {
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

  if (source.className && target.className === target.sourcePath) {
    target.className = source.className;
  }
}

/** Prefer: report without root directory, then densest coverage. */
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

export function mergeRecordGroup(records, inputsWithoutRootDirectory, projectPath = null) {
  const byPath = new Map();

  for (const record of records) {
    const existing = byPath.get(record.sourcePath);
    if (existing) {
      mergeSamePathHits(existing, record);
      continue;
    }

    const copy = createRecord(record.sourcePath, record.inputIndex, record.className);
    mergeSamePathHits(copy, record);
    byPath.set(record.sourcePath, copy);
  }

  const pathRecords = [...byPath.values()];

  // Same project file under different SF spellings — union hits.
  if (projectPath) {
    const merged = createRecord(projectPath, pathRecords[0].inputIndex, pathRecords[0].className);
    for (const record of pathRecords) {
      mergeSamePathHits(merged, record);
    }

    return merged;
  }

  const primary = pickPrimaryRecord(pathRecords, inputsWithoutRootDirectory);
  const merged = createRecord(primary.sourcePath, primary.inputIndex, primary.className);
  mergeSamePathHits(merged, primary);

  // Different suffix (e.g. .js vs .ts): keep primary line map only.
  return merged;
}

export function isRecordEmpty(record) {
  return record.lines.size === 0 && record.functions.size === 0 && record.branches.size === 0;
}

export async function mergeCoverageFiles({
  paths,
  parseRecords,
  extractFilenames,
  normalizeContent,
  serialize,
  outputFilename,
}) {
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
  const repositoryRoot = process.env.GITHUB_WORKSPACE ?? project?.root ?? process.cwd();

  const normalizedContents = contents.map((content) =>
    normalizeContent ? normalizeContent(content, repositoryRoot) : content,
  );

  // Project files already map package-relative paths. Skipping align avoids a wrong root.
  const { sourceRoot, inputsWithoutRootDirectory } = project
    ? { sourceRoot: null, inputsWithoutRootDirectory: null }
    : alignPathRoots(
        normalizedContents.map((content) => extractFilenames(content, repositoryRoot)),
      );

  const resolveToProjectPath = project ? createPathResolver(project.files) : null;
  const groups = new Map();

  for (const [inputIndex, content] of normalizedContents.entries()) {
    for (const record of parseRecords(content, { repositoryRoot, sourceRoot, inputIndex })) {
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

    if (!isRecordEmpty(merged)) {
      mergedRecords.push(merged);
    }
  }

  if (mergedRecords.length === 0) {
    throw new Error('No coverage records found in inputs');
  }

  const output = serialize(mergedRecords);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikido-merged-coverage-'));
  const mergedPath = path.join(tempDir, outputFilename);
  await fs.writeFile(mergedPath, output, 'utf8');

  return mergedPath;
}
