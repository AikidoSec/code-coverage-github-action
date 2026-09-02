import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function loadGitTrackedFiles(cwd = process.cwd()) {
  try {
    const { stdout: rootOut } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
    });
    const repositoryRoot = rootOut.trim();
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, 'ls-files', '-z'], {
      cwd,
    });
    const trackedFiles = stdout
      .split('\0')
      .filter(Boolean)
      .map((filePath) => filePath.replace(/\\/g, '/').replace(/^\.\//, ''));

    if (trackedFiles.length === 0) {
      return null;
    }

    return { root: repositoryRoot, files: trackedFiles };
  } catch {
    return null;
  }
}

// Strip the final suffix so reports that only differ by extension can share a group key
// when git path resolution is unavailable.
export function pathStem(sourcePath) {
  const lastSlashIndex = sourcePath.lastIndexOf('/');
  const lastDotIndex = sourcePath.lastIndexOf('.');
  if (lastDotIndex > lastSlashIndex) {
    return sourcePath.slice(0, lastDotIndex);
  }

  return sourcePath;
}

function normalizePath(filePath) {
  return filePath.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

// True when one path equals the other or continues it after a `/`
// (component-bounded). Same idea as Codecov's network suffix matching.
function isSamePathOrSuffix(path, possibleSuffix) {
  const fullPath = path.toLowerCase();
  const suffix = possibleSuffix.toLowerCase();
  return fullPath === suffix || fullPath.endsWith(`/${suffix}`);
}

function countSharedTrailingSegments(leftPath, rightPath) {
  const leftSegments = leftPath.toLowerCase().split('/');
  const rightSegments = rightPath.toLowerCase().split('/');
  const maxShared = Math.min(leftSegments.length, rightSegments.length);
  let sharedCount = 0;

  while (
    sharedCount < maxShared &&
    leftSegments[leftSegments.length - 1 - sharedCount] ===
      rightSegments[rightSegments.length - 1 - sharedCount]
  ) {
    sharedCount++;
  }

  return sharedCount;
}

function preferClosestGitPath(coveragePath, candidates) {
  const ranked = [...candidates].sort((left, right) => {
    const sharedSegmentsDiff =
      countSharedTrailingSegments(coveragePath, right) -
      countSharedTrailingSegments(coveragePath, left);
    if (sharedSegmentsDiff !== 0) {
      return sharedSegmentsDiff;
    }
    return left.length - right.length;
  });
  const [best, next] = ranked;
  if (next && countSharedTrailingSegments(coveragePath, best) === countSharedTrailingSegments(coveragePath, next) && best.length === next.length) {
    return null;
  }
  return best;
}

function findMatchingGitPaths(trackedFiles, coveragePath) {
  return trackedFiles.filter(
    (trackedPath) =>
      isSamePathOrSuffix(trackedPath, coveragePath) ||
      isSamePathOrSuffix(coveragePath, trackedPath),
  );
}

// Map an SF: path to a git-tracked file (Codecov network-style).
// Unmatched paths return null and should be dropped from the report.
export function createPathResolver(trackedFiles) {
  const exactTrackedPaths = new Set(trackedFiles);

  return (coveragePath) => {
    const normalizedCoveragePath = normalizePath(coveragePath);

    if (exactTrackedPaths.has(normalizedCoveragePath)) {
      return normalizedCoveragePath;
    }

    const matches = findMatchingGitPaths(trackedFiles, normalizedCoveragePath);
    if (matches.length === 0) {
      return null;
    }

    if (matches.length === 1) {
      return matches[0];
    }

    return preferClosestGitPath(normalizedCoveragePath, matches);
  };
}
