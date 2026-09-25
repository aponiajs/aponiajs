import { afterEach, expect, spyOn, test } from "bun:test";
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

test("lays generated source out with the formatter this package declares", async () => {
  const projectRoot = await createTemporaryDirectory();

  // The project is empty, so the answer has to come from the `oxfmt` this
  // package depends on — and it is a real formatter, not the emitter's text
  // passed through.
  expect(await formatGeneratedSource(projectRoot, "invokers.generated.ts", "const a={b:1}\n")).toBe(
    "const a = { b: 1 };\n",
  );
});

test("declares that formatter at an exact version rather than a range", async () => {
  const manifest = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };

  // A range would let the layout of a committed module follow whichever release
  // resolved on the machine that ran the build, which is the drift this
  // dependency exists to remove: the same sources have to produce the same
  // bytes everywhere. The project's own copy is still preferred when it has one
  // (`vite-plus` re-exports this same formatter), so the pin decides the layout
  // a project with no toolchain of its own receives — and
  // `tests/starter-artifact-freshness.test.ts` is what notices when the two
  // copies stop agreeing.
  expect(manifest.dependencies?.oxfmt).toMatch(/^\d+\.\d+\.\d+$/);
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

test("writes the emitters' own layout when no formatter can be loaded", async () => {
  const projectRoot = await createTemporaryDirectory();
  // The project has no toolchain, and the resolver is made to fail for the
  // formatter this package declares: that is a broken install rather than a
  // project this build can fix, and it is the only way to reach the branch. A
  // build is not failed for it — the emitters' source is valid TypeScript, so
  // the module is written as the emitter wrote it.
  const resolveSync = spyOn(Bun, "resolveSync").mockImplementation(() => {
    throw new Error("Cannot find module 'oxfmt'");
  });

  try {
    expect(await formatGeneratedSource(projectRoot, "invokers.generated.ts", "const a=1;\n")).toBe(
      "const a=1;\n",
    );
  } finally {
    resolveSync.mockRestore();
  }
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

test("reports a diagnostic the formatter did not give as an object", async () => {
  const projectRoot = await createTemporaryDirectory();
  await installToolchain(
    projectRoot,
    'export const format = async () => ({ code: "", errors: ["Unexpected token"] });\n',
  );

  // The formatter's report is typed `unknown` here because this package never
  // reads its shape beyond a message, and a diagnostic that is not an object
  // must still reach the reader as itself rather than as `[object Object]`.
  expect(
    formatGeneratedSource(projectRoot, "descriptors.generated.ts", "const = ;\n"),
  ).rejects.toThrow("Unexpected token");
});
