import { describe, expect, test } from "bun:test";
import {
  assertCoverageReport,
  collectExpectedRuntimeSources,
  summarizeCoverage,
} from "./coverage-gate.ts";

const completeReport = `TN:
SF:packages/common/src/index.ts
FNF:4
FNH:4
LF:10
LH:10
end_of_record
TN:
SF:scripts/release.ts
FNF:1
FNH:1
LF:10
LH:9
end_of_record
`;

describe("aggregate coverage gate", () => {
  test("totals LCOV source, function, and line summaries", () => {
    const summary = summarizeCoverage(completeReport);

    expect(summary.functions).toEqual({ covered: 5, found: 5, ratio: 1 });
    expect(summary.lines).toEqual({ covered: 19, found: 20, ratio: 0.95 });
    expect(summary.sources).toEqual(
      new Set(["packages/common/src/index.ts", "scripts/release.ts"]),
    );
  });

  test("accepts reports at the threshold and rejects regressions", () => {
    expect(() =>
      assertCoverageReport(
        completeReport,
        ["packages/common/src/index.ts", "scripts/release.ts"],
        0.95,
      ),
    ).not.toThrow();
    expect(() =>
      assertCoverageReport(completeReport, ["packages/common/src/index.ts"], 0.96),
    ).toThrow("Coverage threshold failed: line: 95.00% < 96.00%.");
  });

  test("rejects missing runtime sources and malformed totals", () => {
    expect(() =>
      assertCoverageReport(completeReport, ["packages/core/src/index.ts"], 0.95),
    ).toThrow("Coverage report is missing runtime sources:");
    expect(() => summarizeCoverage("TN:\nend_of_record\n")).toThrow(
      "Coverage report does not contain LCOV source, function, and line totals.",
    );
    expect(() => summarizeCoverage("SF:file.ts\nFNF:nope\nFNH:0\nLF:1\nLH:1\n")).toThrow(
      "Coverage report contains an invalid count: FNF:nope",
    );
  });

  test("discovers package runtime and release-script sources without type or spec files", async () => {
    const sources = await collectExpectedRuntimeSources(new URL("..", import.meta.url).pathname);

    expect(sources).toContain("packages/common/src/index.ts");
    expect(sources).toContain("scripts/verify-release.ts");
    expect(sources).not.toContain("packages/common/src/logging/logger.types.ts");
    expect(sources).not.toContain("scripts/coverage-gate.spec.ts");
  });
});
