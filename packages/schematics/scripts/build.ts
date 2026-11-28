import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const sourceRoot = join(packageRoot, "src");
const outputRoot = join(packageRoot, "dist");

const compile = Bun.spawnSync(["bunx", "--bun", "tsc", "-p", "tsconfig.build.json"], {
  cwd: packageRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if (compile.exitCode !== 0) {
  process.exit(compile.exitCode);
}

await mkdir(outputRoot, { recursive: true });
await copyAssets(sourceRoot, outputRoot);

/**
 * Copies the schema and template assets beside the compiled factories.
 *
 * `collection.json` points at `dist/lib`, so every asset a factory reads at run
 * time has to be there; TypeScript only emits the modules.
 */
async function copyAssets(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyAssets(source, target);
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      continue;
    }
    await mkdir(to, { recursive: true });
    await cp(source, target);
  }
}
