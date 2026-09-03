import path from 'node:path';

export function normalizeSourcePath(sourcePath, repositoryRoot) {
  const trimmedPath = sourcePath.trim();
  const pathInput = trimmedPath.replaceAll('\\', '/');

  // Use Windows semantics for drive-letter and UNC paths on any runner.
  const windowsPath = /^[a-zA-Z]:[\\/]/.test(trimmedPath) || trimmedPath.startsWith('\\\\');
  const pathApi = windowsPath ? path.win32 : path.posix;
  const absolutePath = pathApi.isAbsolute(pathInput);
  const normalizedPath = absolutePath ? pathApi.relative(repositoryRoot, pathInput) : pathInput;

  // Absolute paths must resolve inside the checkout.
  if (
    absolutePath &&
    (!normalizedPath ||
      normalizedPath === '..' ||
      normalizedPath.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(normalizedPath))
  ) {
    throw new Error(`Invalid source path outside the repository: ${sourcePath}`);
  }

  return normalizedPath.replaceAll('\\', '/');
}

export function normalizeLcovSourcePaths(content, repositoryRoot) {
  return content.replace(
    /^SF:([^\r\n]*)/gm,
    (_directive, sourcePath) => `SF:${normalizeSourcePath(sourcePath, repositoryRoot)}`,
  );
}
