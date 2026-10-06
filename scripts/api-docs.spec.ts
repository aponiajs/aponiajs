import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

/**
 * The API reference TypeDoc builds, and the barrels it builds from.
 *
 * The site is generated output, not a published surface: `docs/api/` is
 * gitignored, and no guard reads it. What the guards read is the source the
 * site is built from — every public export carrying the JSDoc the reference
 * renders — so a reference that stopped documenting is a source change, and
 * this file fails on the source rather than on the site.
 */
const packageBarrels = [
  "packages/common/src/index.ts",
  "packages/core/src/index.ts",
  "packages/platform-elysia/src/index.ts",
  "packages/cli/src/index.ts",
  "packages/cron/src/index.ts",
  "packages/cors/src/index.ts",
  "packages/devtools/src/index.ts",
  "packages/graphql/src/index.ts",
  "packages/mcp/src/index.ts",
  "packages/testing/src/index.ts",
  "packages/openapi/src/index.ts",
  "packages/opentelemetry/src/index.ts",
] as const;

const repositoryRoot = resolve(import.meta.dir, "..");

/**
 * The files one barrel reaches: its own text plus every relative module it
 * re-exports from, one level deep. Several barrels re-export a shared module
 * file rather than naming its exports, and a guard that read only the barrel
 * would pass while the reference rendered an undocumented page.
 */
async function barrelSources(path: string): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  const root = resolve(repositoryRoot, path);
  const content = await Bun.file(root).text();
  sources.set(path, content);

  const directory = root.slice(0, root.lastIndexOf("/"));
  for (const match of content.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const relative = match[1];
    if (relative === undefined) {
      continue;
    }
    const file = `${relative}.ts`.replace(/\.ts\.ts$/, ".ts");
    const full = resolve(directory, file);
    const key = full.slice(repositoryRoot.length + 1);
    if (!sources.has(key)) {
      try {
        sources.set(key, await Bun.file(full).text());
      } catch {
        // A re-export the filesystem does not hold is the module loader's
        // business, not this guard's; TypeDoc fails the build for it.
      }
    }
  }

  return sources;
}

/**
 * The names one source file exports: function and class declarations, const
 * arrow exports, and type aliases and interfaces. Overload signatures collapse
 * under one name, because one documented overload documents the export.
 */
function exportedNames(content: string): readonly string[] {
  const names = new Set<string>();

  for (const match of content.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    names.add(match[1]!);
  }
  for (const match of content.matchAll(/^export\s+(?:abstract\s+)?class\s+(\w+)/gm)) {
    names.add(match[1]!);
  }
  for (const match of content.matchAll(/^export\s+const\s+(\w+)\s*=/gm)) {
    names.add(match[1]!);
  }
  for (const match of content.matchAll(/^export\s+(?:type\s+|interface\s+)(\w+)/gm)) {
    names.add(match[1]!);
  }

  return Object.freeze([...names].sort());
}

/**
 * Whether an export carries the JSDoc the reference renders.
 *
 * The rule is the shape TypeDoc reads: a `/**` block whose close sits
 * directly above the export line, with no blank line between. An export
 * documented anywhere else — a class-level comment above one method, a
 * paragraph two blank lines up — does not render on the export's own page,
 * so it fails here the way it goes missing there. Overloads pass when any
 * one signature carries the block, because TypeDoc renders the set under
 * one page.
 */
function isDocumented(lines: readonly string[], lineIndex: number): boolean {
  let index = lineIndex - 1;
  while (index >= 0 && (lines[index]?.trim() ?? "") === "") {
    index -= 1;
  }
  if (index < 0) {
    return false;
  }

  // A decorator line (`@Module({})`) sits between the comment and the
  // declaration it documents; step past those lines to the comment close.
  while (index >= 0 && (lines[index]?.trim() ?? "").startsWith("@")) {
    index -= 1;
    while (index >= 0 && (lines[index]?.trim() ?? "") === "") {
      index -= 1;
    }
  }

  return (lines[index]?.trim() ?? "").endsWith("*/");
}

/** The undocumented exports of one source file, as `file: name` entries. */
function undocumentedExports(path: string, content: string): readonly string[] {
  const lines = content.split("\n");
  const missing: string[] = [];

  for (const name of exportedNames(content)) {
    const pattern = new RegExp(
      `^export\\s+(?:async\\s+)?(?:function\\s+${name}\\b|(?:abstract\\s+)?class\\s+${name}\\b|const\\s+${name}\\b|(?:type\\s+|interface\\s+)${name}\\b)`,
    );
    const indices: number[] = [];
    lines.forEach((line, lineIndex) => {
      if (pattern.test(line)) {
        indices.push(lineIndex);
      }
    });

    if (indices.length > 0 && !indices.some((lineIndex) => isDocumented(lines, lineIndex))) {
      missing.push(`${path}: ${name}`);
    }
  }

  return missing;
}

describe("API reference documentation", () => {
  test("every barrel in the reference resolves", async () => {
    for (const barrel of packageBarrels) {
      expect(await Bun.file(resolve(repositoryRoot, barrel)).exists()).toBe(true);
    }
  });

  test("every public export carries the JSDoc the reference renders", async () => {
    const missing: string[] = [];

    for (const barrel of packageBarrels) {
      for (const [path, content] of await barrelSources(barrel)) {
        missing.push(...undocumentedExports(path, content));
      }
    }

    expect(missing).toEqual([]);
  });
});
