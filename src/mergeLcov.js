// Merge multiple LCOV inputs into one file for upload. Concatenation is not enough:
// monorepos and sharded CI jobs often emit separate reports for the same source path
// (SF:). We group by path and sum per-line/function/branch hit counts so one record
// per file reflects combined coverage across all inputs.
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');

async function mergeLcov(paths) {
  const coverageBySource = new Map();

  for (const inputPath of paths) {
    const content = await fs.readFile(inputPath, 'utf8');
    parseIntoMap(content, coverageBySource);
  }

  if (coverageBySource.size === 0) {
    throw new Error('No coverage records found in inputs');
  }

  const merged = [...coverageBySource.values()].map(fileCoverageToLcov).join('\n');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aikido-merged-coverage-'));
  const mergedPath = path.join(tempDir, 'lcov.info');
  await fs.writeFile(mergedPath, merged, 'utf8');

  return mergedPath;
}

function splitDirective(line) {
  const separator = line.indexOf(':');
  if (separator === -1) {
    return ['', ''];
  }

  return [line.slice(0, separator), line.slice(separator + 1)];
}

// Walk each record and accumulate DA/FN/FNDA/BRDA into coverageBySource. Summary
// directives (LF, LH, BRF, BRH) are ignored here—they are per-input totals and
// would be wrong after merge; fileCoverageToLcov recomputes them from aggregates.
function parseIntoMap(content, coverageBySource) {
  let current = null;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }

    const [tag, value] = splitDirective(line);

    if (tag === 'SF') {
      current = coverageBySource.get(value) ?? emptyFileCoverage(value);
      coverageBySource.set(value, current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (line === 'end_of_record') {
      current = null;
      continue;
    }

    if (tag === 'DA') {
      const [lineNumber, hits] = value.split(',');
      addLineHits(current, Number(lineNumber), Number(hits));
      continue;
    }

    if (tag === 'FN') {
      const parts = value.split(',');
      const name = parts.slice(1).join(',');
      addFunctionHits(current, name, Number(parts[0]), 0);
      continue;
    }

    if (tag === 'FNDA') {
      const comma = value.indexOf(',');
      addFunctionHits(current, value.slice(comma + 1), null, Number(value.slice(0, comma)));
      continue;
    }

    if (tag === 'BRDA') {
      const [l, block, branch, taken] = value.split(',');
      addBranchHits(current, Number(l), block, branch, taken === '-' ? '-' : Number(taken));
    }
  }
}

function emptyFileCoverage(sourcePath) {
  return { sourcePath, lines: new Map(), functions: new Map(), branches: new Map() };
}

function addLineHits(coverage, line, hits) {
  coverage.lines.set(line, (coverage.lines.get(line) || 0) + hits);
}

function addFunctionHits(coverage, name, line, hits) {
  const prev = coverage.functions.get(name) || { line: 0, hits: 0 };

  coverage.functions.set(name, {
    line: line ?? prev.line,
    hits: prev.hits + hits,
  });
}

// LCOV uses "-" when a branch was never executed. Keep "-" only if every input
// agrees; once any shard took the branch, sum numeric hit counts instead.
function addBranchHits(coverage, line, block, branch, taken) {
  const key = `${line}\0${block}\0${branch}`;
  const prev = coverage.branches.get(key);

  if (taken === '-' && (prev === '-' || prev === undefined)) {
    coverage.branches.set(key, '-');
    return;
  }

  const prevHits = prev === '-' || prev === undefined ? 0 : prev;
  const newHits = taken === '-' ? 0 : taken;
  coverage.branches.set(key, prevHits + newHits);
}

// Serialize one merged record per source file. LF/LH and BRF/BRH are derived from
// the aggregated maps so totals stay consistent with the summed DA/FNDA/BRDA data.
function fileCoverageToLcov(coverage) {
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

  const branchKeys = [...coverage.branches.keys()].sort((a, b) => {
    const [lineA, blockA, branchA] = a.split('\0');
    const [lineB, blockB, branchB] = b.split('\0');

    return (
      Number(lineA) - Number(lineB) ||
      blockA.localeCompare(blockB) ||
      branchA.localeCompare(branchB)
    );
  });

  for (const key of branchKeys) {
    const [line, block, branch] = key.split('\0');
    lines.push(`BRDA:${line},${block},${branch},${coverage.branches.get(key)}`);
  }

  if (coverage.branches.size > 0) {
    const branchesHit = [...coverage.branches.values()].filter((v) => v !== '-' && v > 0).length;
    lines.push(`BRF:${coverage.branches.size}`, `BRH:${branchesHit}`);
  }

  let linesHit = 0;
  const linesKeys = [...coverage.lines.keys()].sort((a, b) => a - b);
  for (const line of linesKeys) {
    const hits = coverage.lines.get(line);
    lines.push(`DA:${line},${hits}`);

    if (hits > 0) {
      linesHit++;
    }
  }

  lines.push(`LF:${coverage.lines.size}`, `LH:${linesHit}`, 'end_of_record');
  return lines.join('\n');
}

module.exports = {
  mergeLcov,
};
