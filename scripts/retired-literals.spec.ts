import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

const repositoryRoot = resolve(import.meta.dir, "..");

/**
 * Literals this framework has retired, and what replaced them.
 *
 * A literal is what a surface states in a value's place, so a document that names
 * one the code no longer emits describes a payload no reader will see. Nothing
 * compiles a document, which is why a rename is the change that leaves this class
 * of defect behind, and why it is guarded here rather than reviewed.
 */
const retiredLiterals = [{ literal: "[unprojectable]", replacedBy: "[unrenderable]" }] as const;

/**
 * The surfaces a reader meets: published documents, package guides, sources, the
 * templates a build ships, the examples, and the tests that state what a surface
 * emits.
 *
 * `docs/superpowers/` is deliberately outside the set. A spec or a plan is the
 * record of a change, so it names the literal it retired on purpose. This guard
 * is inside `scripts/`, which is a covered surface, and it states one as its own
 * data, so it is skipped by name below rather than by sitting outside a pattern.
 *
 * Every pattern is resolved against the repository root rather than the process
 * working directory, so the scan covers the same set wherever it is run from
 * instead of passing over a near-empty one.
 */
const publishedSurfaces = [
  "README.md",
  "AGENTS.md",
  "RULES.md",
  "docs/*.md",
  "docs/learn/*.md",
  "examples/**/*.{ts,md,json}",
  "packages/*/README.md",
  "packages/*/llms.txt",
  "packages/*/AGENTS.md",
  "packages/*/src/**/*.ts",
  "packages/*/tests/**/*.ts",
  "packages/*/tests-vp/**/*.ts",
  "packages/*/e2e/**/*.ts",
  "packages/cli/templates/**",
  "scripts/**/*.ts",
] as const;

/**
 * The one file the surfaces above match that may name a retired literal: this
 * guard, which states one as its own data. Kept as a list rather than by leaving
 * `scripts/` unscanned, so the rest of this directory — and every guard added
 * beside it — stays covered.
 */
const dataFiles: readonly string[] = ["scripts/retired-literals.spec.ts"];

/**
 * A floor under the scan, so a surface list that stopped matching cannot pass by
 * finding nothing: a renamed directory, a moved template, or a dropped pattern
 * leaves the count short. It is a floor rather than an exact number because
 * adding a surface legitimately raises it.
 */
const minimumScannedFiles = 400;

/**
 * One file per pattern, so the floor above cannot be met by one pattern that
 * happens to reach a large directory while another reaches none. A path here is
 * a file a reader meets, so its loss is a change worth failing over.
 */
const requiredFiles: readonly string[] = [
  "AGENTS.md",
  "README.md",
  "RULES.md",
  "docs/logging.md",
  "docs/learn/README.md",
  "examples/basic/src/main.ts",
  "packages/cli/e2e/generated-application.e2e.ts",
  "packages/cli/templates/application/src/main.ts.tmpl",
  "packages/common/src/logging/log-value.ts",
  "packages/devtools/AGENTS.md",
  "packages/devtools/README.md",
  "packages/devtools/llms.txt",
  "packages/devtools/tests/one-line.test.ts",
  "packages/devtools/tests-vp/devtools.conformance.ts",
  "scripts/verify-release.ts",
];

describe("retired literals", () => {
  for (const retired of retiredLiterals) {
    test(`no published surface states ${retired.literal}`, async () => {
      const scanned = new Set<string>();
      const offenders: string[] = [];

      for (const pattern of publishedSurfaces) {
        const scan = new Glob(pattern).scan({ cwd: repositoryRoot, onlyFiles: true });

        for await (const path of scan) {
          if (dataFiles.includes(path)) {
            continue;
          }

          scanned.add(path);

          const content = await Bun.file(join(repositoryRoot, path)).text();
          if (content.includes(retired.literal)) {
            offenders.push(path);
          }
        }
      }

      expect(
        scanned.size,
        `the scan reached ${scanned.size} files, under the ${minimumScannedFiles} a surface list that still matches would reach`,
      ).toBeGreaterThanOrEqual(minimumScannedFiles);

      expect(
        requiredFiles.filter((path) => !scanned.has(path)),
        "surface patterns that reached none of the files they name",
      ).toEqual([]);

      expect(
        offenders.sort(),
        `${retired.literal} is retired; a surface states ${retired.replacedBy} instead`,
      ).toEqual([]);
    });
  }
});
