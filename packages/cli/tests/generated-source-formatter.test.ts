import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatGeneratedSource } from "../src/generation/generated-source-formatter.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

async function createTemporaryDirectory(prefix = "aponia-formatter-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Stands a `vite-plus` package up in a project, so a case can control what the
 * project's own toolchain answers without installing one.
 *
 * A `vite-plus` found in the project is only used when the project actually has
 * it, which is what keeps the resolver from falling back to Bun's global install
 * cache and formatting with a release nobody asked for.
 */
async function installToolchain(projectRoot: string, module: string): Promise<void> {
  const packageDirectory = join(projectRoot, "node_modules", "vite-plus");
  await mkdir(packageDirectory, { recursive: true });
  await Bun.write(
    join(packageDirectory, "package.json"),
    `${JSON.stringify({ name: "vite-plus", version: "0.0.0", type: "module", exports: { "./fmt": "./fmt.js" } })}\n`,
  );
  await Bun.write(join(packageDirectory, "fmt.js"), module);
}

test("lays generated source out with the toolchain the project installed", async () => {
  const projectRoot = await createTemporaryDirectory();
  await installToolchain(
    projectRoot,
    "export const format = async (fileName, sourceText) => ({ code: `// ${fileName}\\n${sourceText}`, errors: [] });\n",
  );

  expect(await formatGeneratedSource(projectRoot, "invokers.generated.ts", "const a=1;\n")).toBe(
    "// invokers.generated.ts\nconst a=1;\n",
  );
});

test("falls back to the toolchain beside this package when the project has none", async () => {
  const projectRoot = await createTemporaryDirectory();

  // The project is empty, so the answer has to come from the copy installed
  // where this package is — and it is a real formatter, not the emitter's text
  // passed through.
  expect(await formatGeneratedSource(projectRoot, "invokers.generated.ts", "const a={b:1}\n")).toBe(
    "const a = { b: 1 };\n",
  );
});

test("falls back when the project's own toolchain cannot be imported", async () => {
  const projectRoot = await createTemporaryDirectory();
  await mkdir(join(projectRoot, "node_modules", "vite-plus"), { recursive: true });
  await Bun.write(
    join(projectRoot, "node_modules", "vite-plus", "package.json"),
    `${JSON.stringify({ name: "vite-plus", version: "0.0.0", type: "module" })}\n`,
  );

  expect(await formatGeneratedSource(projectRoot, "invokers.generated.ts", "const a={b:1}\n")).toBe(
    "const a = { b: 1 };\n",
  );
});

test("reports generated source the formatter cannot parse instead of writing it out", async () => {
  const projectRoot = await createTemporaryDirectory();
  await installToolchain(
    projectRoot,
    'export const format = async () => ({ code: "", errors: [{ message: "Unexpected token" }] });\n',
  );

  expect(
    formatGeneratedSource(projectRoot, "descriptors.generated.ts", "const = ;\n"),
  ).rejects.toThrow("descriptors.generated.ts");
});
