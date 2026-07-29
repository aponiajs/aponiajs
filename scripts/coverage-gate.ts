import { resolve } from "node:path";

const defaultCoverageThreshold = 0.95;

export interface CoverageSummary {
  readonly functions: {
    readonly covered: number;
    readonly found: number;
    readonly ratio: number;
  };
  readonly lines: {
    readonly covered: number;
    readonly found: number;
    readonly ratio: number;
  };
  readonly sources: ReadonlySet<string>;
}

export function assertCoverageReport(
  report: string,
  expectedSources: readonly string[],
  threshold = defaultCoverageThreshold,
): CoverageSummary {
  const summary = summarizeCoverage(report);
  const missingSources = expectedSources.filter((source) => !summary.sources.has(source));
  if (missingSources.length > 0) {
    throw new Error(
      `Coverage report is missing runtime sources:\n- ${missingSources.join("\n- ")}`,
    );
  }

  const measurements: readonly { readonly label: string; readonly ratio: number }[] = [
    { label: "line", ratio: summary.lines.ratio },
    { label: "function", ratio: summary.functions.ratio },
  ];
  const failures = measurements.filter(({ ratio }) => ratio < threshold);
  if (failures.length > 0) {
    const details = failures
      .map(
        ({ label, ratio }) =>
          `${label}: ${formatPercentage(ratio)} < ${formatPercentage(threshold)}`,
      )
      .join(", ");
    throw new Error(`Coverage threshold failed: ${details}.`);
  }

  return summary;
}

export function summarizeCoverage(report: string): CoverageSummary {
  const sources = new Set<string>();
  let functionsCovered = 0;
  let functionsFound = 0;
  let linesCovered = 0;
  let linesFound = 0;

  for (const line of report.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      sources.add(line.slice(3));
      continue;
    }
    if (line.startsWith("FNF:")) {
      functionsFound += readCount(line);
      continue;
    }
    if (line.startsWith("FNH:")) {
      functionsCovered += readCount(line);
      continue;
    }
    if (line.startsWith("LF:")) {
      linesFound += readCount(line);
      continue;
    }
    if (line.startsWith("LH:")) {
      linesCovered += readCount(line);
    }
  }

  if (sources.size === 0 || functionsFound === 0 || linesFound === 0) {
    throw new Error("Coverage report does not contain LCOV source, function, and line totals.");
  }

  return Object.freeze({
    functions: Object.freeze({
      covered: functionsCovered,
      found: functionsFound,
      ratio: functionsCovered / functionsFound,
    }),
    lines: Object.freeze({
      covered: linesCovered,
      found: linesFound,
      ratio: linesCovered / linesFound,
    }),
    sources,
  });
}

export async function collectExpectedRuntimeSources(
  workspaceRoot: string,
): Promise<readonly string[]> {
  const packageSources = await Array.fromAsync(
    new Bun.Glob("packages/*/src/**/*.ts").scan({
      cwd: workspaceRoot,
      onlyFiles: true,
    }),
  );
  const scriptSources = await Array.fromAsync(
    new Bun.Glob("scripts/*.ts").scan({
      cwd: workspaceRoot,
      onlyFiles: true,
    }),
  );

  return Object.freeze(
    [...packageSources, ...scriptSources]
      .filter((path) => !path.endsWith(".types.ts") && !path.endsWith(".spec.ts"))
      .toSorted(),
  );
}

function readCount(line: string): number {
  const count = Number(line.slice(line.indexOf(":") + 1));
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Coverage report contains an invalid count: ${line}`);
  }
  return count;
}

function formatPercentage(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

if (import.meta.main) {
  const workspaceRoot = resolve(import.meta.dir, "..");
  const report = await Bun.file(resolve(workspaceRoot, "coverage/lcov.info")).text();
  const expectedSources = await collectExpectedRuntimeSources(workspaceRoot);
  const summary = assertCoverageReport(report, expectedSources);

  console.log(
    `Verified aggregate coverage: ${formatPercentage(summary.lines.ratio)} lines, ${formatPercentage(summary.functions.ratio)} functions.`,
  );
}
