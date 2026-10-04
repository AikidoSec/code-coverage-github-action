import path from 'node:path';
import * as glob from '@actions/glob';
import { normalizePathSeparators, validateFilePath } from './paths.js';

/**
 * Expand glob patterns (and literal paths) to workspace-relative file paths.
 * Every pattern must match at least one file.
 */
export async function resolveInputFilePatterns(patterns) {
  const cwd = process.cwd();
  const resolvedPaths = [];

  for (const pattern of patterns) {
    validateFilePath(pattern);

    const globber = await glob.create(pattern, {
      followSymbolicLinks: false,
      matchDirectories: false,
    });
    const matches = await globber.glob();

    if (matches.length === 0) {
      throw new Error(`No file(s) found matching "${pattern}"`);
    }

    for (const match of matches.sort()) {
      const relativePath = normalizePathSeparators(path.relative(cwd, match));
      validateFilePath(relativePath);
      resolvedPaths.push(relativePath);
    }
  }

  return [...new Set(resolvedPaths)];
}
