import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, test } from "bun:test";

interface PackageLayout {
  readonly sourceRoot: string;
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

/**
 * The Nest-shaped package trees.
 *
 * `files` states the root files a package may own beside `index.ts`; a
 * colocated `*.spec.ts` is allowed at any depth by the suffix rule below and is
 * deliberately not listed. `directories` is exact, so a new owner directory is
 * a deliberate edit to this table.
 */
const packageLayouts: readonly PackageLayout[] = [
  {
    sourceRoot: "packages/aponiajs/src",
    files: ["index.ts"],
    directories: [],
  },
  {
    sourceRoot: "packages/audit/src",
    files: ["index.ts"],
    directories: ["interfaces", "module", "service", "store"],
  },
  {
    sourceRoot: "packages/auth/src",
    files: [
      "auth.constants.ts",
      "auth.guard.ts",
      "auth.module-definition.ts",
      "auth.module.ts",
      "auth.service.ts",
      "authorization.decorator.ts",
      "claims.ts",
      "current-user.decorator.ts",
      "index.ts",
      "jwt.service.ts",
      "memory-refresh-token.store.ts",
      "memory-revocation.store.ts",
      "oidc.service.ts",
      "permissions.guard.ts",
      "refresh-token.service.ts",
      "revocation.service.ts",
    ],
    directories: ["interfaces", "password"],
  },
  {
    sourceRoot: "packages/cache/src",
    files: [
      "cache.constants.ts",
      "cache.module-definition.ts",
      "cache.module.ts",
      "cache.service.ts",
      "index.ts",
      "memory-cache.store.ts",
    ],
    directories: ["decorators", "interceptors", "interfaces"],
  },
  {
    sourceRoot: "packages/cli/src",
    files: ["index.ts", "version.ts"],
    directories: [
      "agent",
      "bundler",
      "commands",
      "contracts",
      "generation",
      "interfaces",
      "library",
    ],
  },
  {
    sourceRoot: "packages/common/src",
    files: ["index.ts"],
    directories: [
      "async-context",
      "configuration",
      "decorators",
      "enhancers",
      "exceptions",
      "interfaces",
      "mcp",
      "microservices",
      "module-utils",
      "modules",
      "pipes",
      "providers",
      "routing",
      "services",
      "tokens",
      "websockets",
    ],
  },
  {
    sourceRoot: "packages/compiler/src",
    files: ["index.ts"],
    directories: ["borrow", "interfaces", "lifetime", "shared", "typestate"],
  },
  {
    sourceRoot: "packages/compression/src",
    files: ["index.ts"],
    directories: ["interfaces", "module", "policy"],
  },
  {
    sourceRoot: "packages/core/src",
    files: ["constants.ts", "index.ts"],
    directories: ["hooks", "injector", "interfaces", "scanner"],
  },
  {
    sourceRoot: "packages/cors/src",
    files: ["index.ts"],
    directories: ["interfaces", "module", "policy"],
  },
  {
    sourceRoot: "packages/cron/src",
    files: ["cron.constants.ts", "cron.module-definition.ts", "cron.module.ts", "index.ts"],
    directories: ["decorators", "interfaces", "scheduler"],
  },
  {
    sourceRoot: "packages/database/src",
    files: [
      "database.module-definition.ts",
      "database.module.ts",
      "database.service.ts",
      "index.ts",
    ],
    directories: ["interfaces", "migration", "repository"],
  },
  {
    sourceRoot: "packages/devtools/src",
    files: ["index.ts", "version.ts"],
    directories: [
      "buffer",
      "endpoints",
      "interfaces",
      "logging",
      "module",
      "requests",
      "server",
      "source",
    ],
  },
  {
    sourceRoot: "packages/events/src",
    files: ["event-emitter.ts", "events.constants.ts", "events.module.ts", "index.ts"],
    directories: ["decorators", "interfaces"],
  },
  {
    sourceRoot: "packages/graphql/src",
    files: ["graphql.module.ts", "index.ts"],
    directories: ["endpoint", "interfaces"],
  },
  { sourceRoot: "packages/h3/src", files: ["index.ts"], directories: [] },
  { sourceRoot: "packages/hono/src", files: ["index.ts"], directories: [] },
  {
    sourceRoot: "packages/http/src",
    files: [
      "http-client.constants.ts",
      "http-client.providers.ts",
      "http-client.service.ts",
      "http.module-definition.ts",
      "http.module.ts",
      "index.ts",
      "inject-http-client.decorator.ts",
    ],
    directories: ["interfaces", "security"],
  },
  {
    sourceRoot: "packages/idempotency/src",
    files: ["index.ts"],
    directories: ["interfaces", "module", "runtime", "store"],
  },
  {
    sourceRoot: "packages/mcp/src",
    files: ["index.ts"],
    directories: ["discovery", "execution", "interfaces", "module", "transport"],
  },
  {
    sourceRoot: "packages/metrics/src",
    files: [
      "index.ts",
      "metrics-instrumentation.ts",
      "metrics-plugin.types.ts",
      "metrics.constants.ts",
      "metrics.controller.ts",
      "metrics.filter.ts",
      "metrics.module.ts",
    ],
    directories: ["interfaces", "registry"],
  },
  {
    sourceRoot: "packages/microservices/src",
    files: ["index.ts"],
    directories: ["brokers", "client", "envelope", "interfaces", "module", "server", "transport"],
  },
  { sourceRoot: "packages/nitro/src", files: ["index.ts"], directories: [] },
  {
    sourceRoot: "packages/openapi/src",
    files: ["index.ts", "openapi.module.ts"],
    directories: ["document", "interfaces"],
  },
  {
    sourceRoot: "packages/opentelemetry/src",
    files: ["index.ts"],
    directories: ["interfaces", "module", "tracing"],
  },
  {
    sourceRoot: "packages/platform-core/src",
    files: ["index.ts"],
    directories: [
      "application",
      "artifacts",
      "capabilities",
      "configuration",
      "enhancers",
      "exceptions",
      "health",
      "host",
      "interfaces",
      "kernel",
      "middleware",
      "modules",
      "pipes",
      "platform",
      "policy",
      "request-context",
      "routing",
      "security",
      "websockets",
    ],
  },
  {
    sourceRoot: "packages/platform-elysia/src",
    files: ["index.ts", "version.ts"],
    directories: [
      "adapters",
      "application",
      "compiler",
      "configuration",
      "controllers",
      "exceptions",
      "inspection",
      "interfaces",
      "microservices",
      "middleware",
      "modules",
      "plugins",
      "request-context",
      "routing",
      "websockets",
    ],
  },
  {
    sourceRoot: "packages/platform-h3/src",
    files: ["index.ts"],
    directories: ["application", "host", "routing"],
  },
  {
    sourceRoot: "packages/platform-hono/src",
    files: ["index.ts"],
    directories: ["application", "host", "routing"],
  },
  {
    sourceRoot: "packages/queue/src",
    files: ["index.ts", "queue.module-definition.ts", "queue.module.ts"],
    directories: ["decorators", "hosts", "interfaces", "outbox", "processors", "queue"],
  },
  {
    sourceRoot: "packages/rate-limit/src",
    files: ["index.ts"],
    directories: ["guard", "module", "service", "store"],
  },
  {
    sourceRoot: "packages/schematics/src",
    files: ["index.ts"],
    directories: ["lib"],
  },
  {
    sourceRoot: "packages/security/src",
    files: ["index.ts"],
    directories: ["interfaces", "module", "policy"],
  },
  {
    sourceRoot: "packages/serverless/src",
    files: ["index.ts"],
    directories: ["fetch", "interfaces", "lambda"],
  },
  {
    sourceRoot: "packages/session/src",
    files: ["index.ts"],
    directories: ["interfaces", "middleware", "module", "policy", "service", "store"],
  },
  {
    sourceRoot: "packages/store-redis/src",
    files: ["index.ts"],
    directories: ["common", "interfaces", "stores"],
  },
  {
    sourceRoot: "packages/tenancy/src",
    files: [
      "index.ts",
      "tenancy.constants.ts",
      "tenancy.module-definition.ts",
      "tenancy.module.ts",
      "tenant.constants.ts",
      "tenant.guard.ts",
      "tenant.service.ts",
    ],
    directories: ["interfaces"],
  },
  {
    sourceRoot: "packages/testing/src",
    files: ["index.ts"],
    directories: ["application", "conformance", "interfaces", "overrides"],
  },
  {
    sourceRoot: "packages/view/src",
    files: ["index.ts"],
    directories: ["engines", "helper", "interfaces", "module"],
  },
];

/**
 * The Nest kind suffixes this repository publishes, plus the descriptive
 * suffixes the naming contract keeps where Nest has no kind for the file. A
 * dotted name whose last segment is outside this list is a new suffix the
 * layout guard must be taught deliberately.
 */
const allowedSuffixes: readonly string[] = [
  "accessor",
  "builder",
  "conformance",
  "constants",
  "controller",
  "decorator",
  "dto",
  "e2e-spec",
  "entity",
  "exception",
  "explorer",
  "factory",
  "filter",
  "gateway",
  "guard",
  "handler",
  "interceptor",
  "interface",
  "middleware",
  "module",
  "module-definition",
  "pipe",
  "policy",
  "provider",
  "providers",
  "registry",
  "repository",
  "resolver",
  "service",
  "spec",
  "store",
  "strategy",
  "types",
];

const typescriptTranspiler = new Bun.Transpiler({ loader: "ts" });
const moduleSpecifierPattern = /(?:\bfrom\s+|\bimport\s*)["']([^"']+)["']/g;

describe("framework source layout", () => {
  test("keeps implementation inside explicit owner directories", async () => {
    for (const layout of packageLayouts) {
      const entries = await readdir(layout.sourceRoot, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && !entry.name.endsWith(".spec.ts"))
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

  test("names every file with a Nest kind suffix or a descriptive name", async () => {
    for (const layout of packageLayouts) {
      const sourceFiles = await listTypeScriptFiles(layout.sourceRoot);
      for (const file of sourceFiles) {
        const name = basename(file);
        const stem = name.slice(0, -".ts".length);
        const separator = stem.indexOf(".");
        if (separator === -1) {
          continue;
        }
        const suffix =
          stem
            .slice(separator + 1)
            .split(".")
            .at(-1) ?? "";
        expect(allowedSuffixes, `${file} must use an allowed Nest suffix`).toContain(suffix);
      }
    }
  });

  test("keeps type modules free of emitted runtime statements", async () => {
    for (const layout of packageLayouts) {
      const sourceFiles = await listTypeScriptFiles(layout.sourceRoot);
      const typeModules = sourceFiles.filter(
        (candidate) => candidate.endsWith(".types.ts") || candidate.endsWith(".interface.ts"),
      );
      for (const file of typeModules) {
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
        // A spec states the source it expects a generator to write, and that
        // text carries the generated project's own `.js` extensions. Its real
        // imports are resolved by the type checker, which is the stronger check.
        if (file.endsWith(".spec.ts")) {
          continue;
        }
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
