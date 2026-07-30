import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, test } from "bun:test";

interface PackageLayout {
  readonly sourceRoot: string;
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

const packageLayouts: readonly PackageLayout[] = [
  {
    sourceRoot: "packages/common/src",
    files: ["index.ts"],
    directories: [
      "controllers",
      "decorators",
      "errors",
      "logging",
      "modules",
      "providers",
      "routing",
      "tokens",
      "websockets",
    ],
  },
  {
    sourceRoot: "packages/core/src",
    files: ["index.ts"],
    directories: ["container", "graph"],
  },
  {
    sourceRoot: "packages/platform-elysia/src",
    files: ["index.ts"],
    directories: [
      "application",
      "controllers",
      "errors",
      "modules",
      "plugins",
      "routing",
      "websockets",
    ],
  },
  {
    sourceRoot: "packages/cli/src",
    files: ["index.ts", "version.ts"],
    directories: ["commands", "generation"],
  },
  {
    sourceRoot: "packages/aponiajs/src",
    files: ["index.ts"],
    directories: [],
  },
];

const typescriptTranspiler = new Bun.Transpiler({ loader: "ts" });
const moduleSpecifierPattern = /(?:\bfrom\s+|\bimport\s*)["']([^"']+)["']/g;

describe("framework source layout", () => {
  test("keeps implementation inside explicit owner directories", async () => {
    for (const layout of packageLayouts) {
      const entries = await readdir(layout.sourceRoot, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .toSorted();
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted();

      expect(files).toEqual([...layout.files].toSorted());
      expect(directories).toEqual([...layout.directories].toSorted());
    }
  });

  test("uses one public barrel per package", async () => {
    for (const layout of packageLayouts) {
      const sourceFiles = await listTypeScriptFiles(layout.sourceRoot);
      const barrelFiles = sourceFiles.filter((file) => basename(file) === "index.ts");

      expect(barrelFiles).toEqual([join(layout.sourceRoot, "index.ts")]);
    }
  });

  test("keeps type modules free of emitted runtime statements", async () => {
    for (const layout of packageLayouts) {
      const sourceFiles = await listTypeScriptFiles(layout.sourceRoot);
      for (const file of sourceFiles.filter((candidate) => candidate.endsWith(".types.ts"))) {
        const source = await Bun.file(file).text();
        const emittedJavaScript = typescriptTranspiler.transformSync(source);

        expect(emittedJavaScript.trim(), `${file} must remain type-only`).toBe("");
      }
    }
  });

  test("uses explicit TypeScript extensions for local module boundaries", async () => {
    for (const layout of packageLayouts) {
      const sourceFiles = await listTypeScriptFiles(layout.sourceRoot);
      for (const file of sourceFiles) {
        const source = await Bun.file(file).text();
        for (const match of source.matchAll(moduleSpecifierPattern)) {
          const moduleSpecifier = match[1];
          if (moduleSpecifier?.startsWith(".")) {
            expect(moduleSpecifier.endsWith(".ts") || moduleSpecifier.endsWith(".json"), file).toBe(
              true,
            );
          }
        }
      }
    }
  });
});

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          return listTypeScriptFiles(path);
        }
        return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
      }),
  );
  return files.flat();
}
