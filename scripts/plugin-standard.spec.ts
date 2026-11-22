import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * The platform standard, enforced over the workspace.
 *
 * A published package is runtime-neutral: it depends on `@aponiajs/common`,
 * `@aponiajs/core`, and `@aponiajs/platform-core`, and a runtime it mounts
 * lives behind the platform declaration rather than in its own source. The
 * packages below still wrap an Elysia plugin; the list is a debt register, not
 * a permission — a package that becomes portable must be removed from it, and
 * a package that is not on it may not gain a runtime import.
 */
const pendingPort = new Set([
  "compression",
  "cors",
  "devtools",
  "graphql",
  "idempotency",
  "mcp",
  "metrics",
  "opentelemetry",
  "openapi",
  "security",
  "testing",
]);

/** Packages whose job is a runtime, or the toolchain around one. */
const platformPackages = new Set([
  "aponiajs",
  "cli",
  "create-aponia",
  "h3",
  "hono",
  "nitro",
  "platform-core",
  "platform-elysia",
  "platform-h3",
  "platform-hono",
  "serverless",
]);

const runtimeImport =
  /from\s+"(?:elysia(?:\/|")|@elysia\/|hono(?:\/|")|h3(?:\/|")|nitro(?:\/|")|@aponiajs\/platform-(?:elysia|hono|h3|nitro))/;

const workspaceRoot = new URL("..", import.meta.url).pathname;

async function readPackageNames(): Promise<string[]> {
  const glob = new Bun.Glob("packages/*/package.json");
  const names: string[] = [];
  for await (const path of glob.scan({ cwd: workspaceRoot, onlyFiles: true })) {
    const manifest = (await Bun.file(join(workspaceRoot, path)).json()) as {
      readonly name?: string;
    };
    if (manifest.name !== undefined) {
      names.push(manifest.name);
    }
  }
  return names.sort();
}

function directoryOf(name: string): string {
  return name.replace("@aponiajs/", "");
}

async function runtimeImportsOf(directory: string): Promise<string[]> {
  const glob = new Bun.Glob("src/**/*.ts");
  const hits: string[] = [];
  for await (const path of glob.scan({ cwd: join(workspaceRoot, "packages", directory) })) {
    if (path.startsWith("src/adapters/")) {
      continue;
    }
    const source = await Bun.file(join(workspaceRoot, "packages", directory, path)).text();
    if (runtimeImport.test(source)) {
      hits.push(path);
    }
  }
  return hits.sort();
}

describe("the platform standard", () => {
  test("a package imports a runtime only when it is a known, tracked exception", async () => {
    const names = await readPackageNames();
    const untracked: string[] = [];

    for (const name of names) {
      const directory = directoryOf(name);
      if (platformPackages.has(directory)) {
        continue;
      }
      const hits = await runtimeImportsOf(directory);
      if (hits.length > 0 && !pendingPort.has(directory)) {
        untracked.push(`${directory}: ${hits.join(", ")}`);
      }
    }

    expect(untracked).toEqual([]);
  });

  test("the debt register holds only packages that still import a runtime", async () => {
    const names = await readPackageNames();
    const portable: string[] = [];

    for (const directory of pendingPort) {
      if (!names.some((name) => directoryOf(name) === directory)) {
        continue;
      }
      if ((await runtimeImportsOf(directory)).length === 0) {
        portable.push(directory);
      }
    }

    expect(portable).toEqual([]);
  });

  test("the engine and the first-party guards are runtime-neutral", async () => {
    for (const directory of ["common", "core", "platform-core"]) {
      expect(await runtimeImportsOf(directory)).toEqual([]);
    }
  });
});
