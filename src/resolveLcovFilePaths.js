import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as glob from '@actions/glob';

/**
 * Validate that a file path is safe to read.
 * Rejects absolute paths and paths containing '..' segments to prevent
 * directory traversal and arbitrary file access.
 */
function assertSafePattern(pattern) {
  const segments = pattern.split(/[\\/]+/);

  if (path.isAbsolute(pattern) || segments.includes('..')) {
    throw new Error(
      `Invalid file path: absolute paths and ".." segments are not allowed (got "${pattern}")`,
    );
  }
}

async function matchPattern(pattern, cwd) {
  assertSafePattern(pattern);

  const globber = await glob.create(pattern, {
    followSymbolicLinks: false,
    matchDirectories: false,
  });
  const matches = await globber.glob();

  if (matches.length === 0) {
    throw new Error(`No file(s) found matching "${pattern}"`);
  }

  return Promise.all(
    matches.sort().map(async (match) => {
      const resolvedPath = path.resolve(match);
      const relativePath = path.relative(cwd, resolvedPath);

      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Invalid file path: "${pattern}" resolved outside the workspace`);
      }

      // followSymbolicLinks: false above only stops glob from descending into symlinked
      // directories; it still returns a symlinked file as a match, so check explicitly.
      if ((await fs.lstat(resolvedPath)).isSymbolicLink()) {
        throw new Error(`Invalid file path: "${pattern}" matched a symlink, which is not allowed`);
      }

      return resolvedPath;
    }),
  );
}

// Every pattern must match at least one file, so a typo fails loudly instead of silently dropping coverage.
export async function resolveLcovFilePaths(patterns) {
  const cwd = process.cwd();
  const resolvedPaths = [];

  for (const pattern of patterns) {
    resolvedPaths.push(...(await matchPattern(pattern, cwd)));
  }

  return [...new Set(resolvedPaths)];
}
