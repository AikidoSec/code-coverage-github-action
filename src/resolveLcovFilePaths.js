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

// Every pattern must match at least one file, so a typo fails loudly instead of silently dropping coverage.
export async function resolveLcovFilePaths(patterns) {
  const cwd = process.cwd();
  const seen = new Set();
  const resolvedPaths = [];

  for (const pattern of patterns) {
    assertSafePattern(pattern);

    const globber = await glob.create(pattern, {
      followSymbolicLinks: false,
      matchDirectories: false,
    });
    const matches = await globber.glob();

    if (matches.length === 0) {
      throw new Error(`No file(s) found matching "${pattern}"`);
    }

    for (const match of matches.sort()) {
      const resolvedPath = path.resolve(match);
      const relativePath = path.relative(cwd, resolvedPath);

      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Invalid file path: "${pattern}" resolved outside the workspace`);
      }

      if (!seen.has(resolvedPath)) {
        seen.add(resolvedPath);
        resolvedPaths.push(resolvedPath);
      }
    }
  }

  return resolvedPaths;
}
