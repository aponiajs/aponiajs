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
  // The test kit builds an Elysia test application by design: it is the
  // platform's test surface, not a plugin.
  "testing",
]);

/**
 * Packages migrated to the neutral contract.
 *
 * Each contributes only providers, controllers, HTTP policies, request
 * lifecycle hooks, and capability requirements. The guard below refuses a
 * platform declaration, a platform token, and a runtime import in every one of
 * them, so a regression cannot arrive quietly.
 */
const neutralSeams = new Set([
  "compression",
  "cors",
  "graphql",
  "idempotency",
  "mcp",
  "metrics",
  "openapi",
  "opentelemetry",
  "security",
  "session",
  "devtools",
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
    // A colocated spec drives a runtime to prove the contract; the rule is about
    // the source a published package ships.
    if (path.startsWith("src/adapters/") || path.endsWith(".spec.ts")) {
      continue;
    }
    const source = await Bun.file(join(workspaceRoot, "packages", directory, path)).text();
    if (runtimeImport.test(source)) {
      hits.push(path);
    }
  }
  return hits.sort();
}

describe("the plugin registration standard", () => {
  /** Modules that register a `ConfigurationToken`; its provider is the async path. */
  const configurationModules = new Set(["cors", "cron", "graphql", "openapi", "opentelemetry"]);

  /** Modules that take no options, so a synchronous `forRoot()` is the whole contract. */
  const optionlessModules = new Set(["events"]);

  /**
   * Modules whose synchronous registration decides which providers exist, which
   * a container factory cannot change: auth picks a JWT or an OIDC verifier, and
   * devtools mounts nothing at all when disabled. Their package guide states the
   * limit; both are the documented exception rather than an unfinished async form.
   */
  const registrationShapedModules = new Set(["auth", "devtools"]);

  async function moduleSources(): Promise<Map<string, string>> {
    const sources = new Map<string, string>();
    const glob = new Bun.Glob("packages/*/src/module/*-module.ts");
    for await (const path of glob.scan({ cwd: workspaceRoot, onlyFiles: true })) {
      const directory = path.split("/")[1]!;
      sources.set(directory, await Bun.file(join(workspaceRoot, path)).text());
    }
    return sources;
  }

  test("every module package registers through forRoot", async () => {
    const missing: string[] = [];
    for (const [directory, source] of await moduleSources()) {
      if (!/\bforRoot\b/.test(source)) {
        missing.push(directory);
      }
    }
    expect(missing).toEqual([]);
  });

  test("every configurable module package accepts forRootAsync", async () => {
    const missing: string[] = [];
    for (const [directory, source] of await moduleSources()) {
      if (
        configurationModules.has(directory) ||
        optionlessModules.has(directory) ||
        registrationShapedModules.has(directory)
      ) {
        continue;
      }
      if (!/\bforRootAsync\b/.test(source)) {
        missing.push(directory);
      }
    }
    expect(missing).toEqual([]);
  });

  test("every registration names its own module class as the identity", async () => {
    const offenders: string[] = [];
    for (const [directory, source] of await moduleSources()) {
      const moduleClass = /^export (?:abstract )?class (\w+Module)\b/m.exec(source)?.[1];
      if (moduleClass === undefined) {
        continue;
      }
      if (!source.includes(`module: ${moduleClass}`) && !source.includes("module: this")) {
        offenders.push(`${directory}: ${moduleClass}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("a registration never spreads another module into its definition", async () => {
    const offenders: string[] = [];
    for (const [directory, source] of await moduleSources()) {
      if (/\.\.\.(?:pluginModule|mounted|parentModule)\b/.test(source)) {
        offenders.push(directory);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("a plugin module source depends on the neutral platform, not the Elysia adapter", async () => {
    const offenders: string[] = [];
    for (const [directory, source] of await moduleSources()) {
      if (directory === "devtools") {
        // The devtools surface reads the Elysia boot record and mounts its own
        // Elysia plugin by design; its package guide states the exception.
        continue;
      }
      if (source.includes('from "@aponiajs/platform-elysia"')) {
        offenders.push(directory);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("a retained register alias delegates to forRoot", async () => {
    const nonDelegating: string[] = [];
    for (const [directory, source] of await moduleSources()) {
      const alias = source.match(
        /static\s+register\s*(?:<[^>]*>)?\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s*\}/,
      );
      if (alias === null) {
        continue;
      }
      if (!/\bforRoot\s*\(/.test(alias[1]!)) {
        nonDelegating.push(directory);
      }
    }
    expect(nonDelegating).toEqual([]);
  });
});

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

  test("a migrated seam package states no platform declaration and imports no runtime", async () => {
    const offenders: string[] = [];
    const platformDeclaration =
      /providePlatformModule|\bPLATFORM_MODULE\b|\bplatforms\s*:|\badapters\s*:|\b[A-Z_]+_ADAPTER\b/;

    for (const directory of neutralSeams) {
      const glob = new Bun.Glob("src/**/*.ts");
      for await (const path of glob.scan({
        cwd: join(workspaceRoot, "packages", directory),
        onlyFiles: true,
      })) {
        if (path.endsWith(".spec.ts")) {
          continue;
        }
        const source = await Bun.file(join(workspaceRoot, "packages", directory, path)).text();
        if (platformDeclaration.test(source) || runtimeImport.test(source)) {
          offenders.push(`${directory}: ${path}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
