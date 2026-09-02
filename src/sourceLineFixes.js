import { promises as fs } from 'node:fs';
import path from 'node:path';

// Drop coverage that points past the end of the source file.
// Codecov's language-specific content fixes (empty lines, comments, braces) are
// applied per-extension in their uploader and are not language-agnostic — we only
// keep the universal EOF bound. See https://docs.codecov.com/docs/fixing-reports
export async function loadSourceLineFixes(repositoryRoot, sourcePath) {
  if (!repositoryRoot || !sourcePath) {
    return null;
  }

  try {
    const content = await fs.readFile(path.join(repositoryRoot, sourcePath), 'utf8');
    const lineCount = content.split(/\r?\n/).length;
    return { eof: lineCount };
  } catch {
    return null;
  }
}

export function applySourceLineFixes(record, lineFixes) {
  if (!lineFixes) {
    return record;
  }

  const { eof } = lineFixes;

  for (const lineNumber of [...record.lines.keys()]) {
    if (lineNumber < 1 || lineNumber > eof) {
      record.lines.delete(lineNumber);
    }
  }

  for (const [functionName, meta] of [...record.functions.entries()]) {
    if (meta.line < 1 || meta.line > eof) {
      record.functions.delete(functionName);
    }
  }

  for (const branchKey of [...record.branches.keys()]) {
    const lineNumber = Number(branchKey.split('\0')[0]);
    if (lineNumber < 1 || lineNumber > eof) {
      record.branches.delete(branchKey);
    }
  }

  return record;
}
