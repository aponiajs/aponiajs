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
 * The surfaces a reader meets: published documents, package guides, sources, and
 * the tests that state what a surface emits.
 *
 * `docs/superpowers/` is deliberately outside the set. A spec or a plan is the
 * record of a change, so it names the literal it retired on purpose — including
 * this file, which states one as its own data.
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
  "packages/*/README.md",
  "packages/*/llms.txt",
  "packages/*/AGENTS.md",
  "packages/*/src/**/*.ts",
  "packages/*/tests/**/*.ts",
  "packages/*/tests-vp/**/*.ts",
] as const;

describe("retired literals", () => {
  for (const retired of retiredLiterals) {
    test(`no published surface states ${retired.literal}`, async () => {
      const offenders: string[] = [];

      for (const pattern of publishedSurfaces) {
        const scan = new Glob(pattern).scan({ cwd: repositoryRoot, onlyFiles: true });

        for await (const path of scan) {
          const content = await Bun.file(join(repositoryRoot, path)).text();
          if (content.includes(retired.literal)) {
            offenders.push(path);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});
