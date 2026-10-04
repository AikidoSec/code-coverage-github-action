import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadProjectFiles } from './projectFiles.js';
import { loadSourceLineFixes } from './sourceLineFixes.js';
import { validateFilePath } from './paths.js';
import { detectFormatFromFilename, extractCoveredSourcePaths } from './reportPaths.js';

/**
 * Read coverage files and collect repository_source_paths + EOF metadata for backend processing.
 * @param {string[]} filePaths
 */
export async function collectUploadPayload(filePaths) {
  if (filePaths.length === 0) {
    throw new Error('No code coverage file(s) provided. Specify at least one path.');
  }

  for (const inputPath of filePaths) {
    validateFilePath(inputPath);
  }

  const project = await loadProjectFiles();
  if (!project || project.files.length === 0) {
    throw new Error(
      'No source files found in this repository. ' +
        'Check out the repository in this job (e.g. actions/checkout) before uploading coverage.',
    );
  }

  const repositoryRoot = process.env.GITHUB_WORKSPACE ?? project.root;
  const files = [];
  const coveredPaths = new Set();

  for (const inputPath of filePaths) {
    const absolutePath = path.resolve(inputPath);
    const content = await fs.readFile(absolutePath, 'utf8');
    const format = detectFormatFromFilename(inputPath);

    for (const sourcePath of extractCoveredSourcePaths(content, format, repositoryRoot)) {
      coveredPaths.add(sourcePath);
    }

    files.push({
      filename: path.posix.basename(inputPath.replaceAll('\\', '/')),
      format,
      content,
    });
  }

  const eof = {};
  for (const sourcePath of coveredPaths) {
    const fixes = await loadSourceLineFixes(repositoryRoot, sourcePath);
    if (fixes?.eof != null) {
      eof[sourcePath] = fixes.eof;
    }
  }

  return {
    repository_source_paths: project.files,
    eof,
    files,
  };
}
