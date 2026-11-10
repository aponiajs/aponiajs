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
      "configuration",
      "controllers",
      "decorators",
      "enhancers",
      "errors",
      "lifecycle",
      "logging",
      "middleware",
      "microservices",
      "modules",
      "pipes",
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
    sourceRoot: "packages/cache/src",
    files: ["index.ts"],
    directories: ["module", "service", "store"],
  },
  {
    sourceRoot: "packages/compression/src",
    files: ["index.ts"],
    directories: ["module", "policy"],
  },
  {
    sourceRoot: "packages/events/src",
    files: ["index.ts"],
    directories: ["emitter", "listener", "module"],
  },
  {
    sourceRoot: "packages/http/src",
    files: ["index.ts"],
    directories: ["client", "module", "security"],
  },
  {
    sourceRoot: "packages/rate-limit/src",
    files: ["index.ts"],
    directories: ["guard", "module", "service", "store"],
  },
  {
    sourceRoot: "packages/security/src",
    files: ["index.ts"],
    directories: ["module", "policy"],
  },
  {
    sourceRoot: "packages/session/src",
    files: ["index.ts"],
    directories: ["module", "policy", "service", "store"],
  },
  {
    sourceRoot: "packages/platform-elysia/src",
    files: ["index.ts", "version.ts"],
    directories: [
      "application",
      "compiler",
      "configuration",
      "controllers",
      "enhancers",
      "errors",
      "inspection",
      "middleware",
      "microservices",
      "modules",
      "pipes",
      "plugins",
      "request-context",
      "routing",
      "websockets",
    ],
  },
  {
    sourceRoot: "packages/cron/src",
    files: ["index.ts"],
    directories: ["module", "scheduler"],
  },
  {
    sourceRoot: "packages/cors/src",
    files: ["index.ts"],
    directories: ["module", "policy"],
  },
  {
    sourceRoot: "packages/devtools/src",
    files: ["index.ts", "version.ts"],
    directories: [
      "buffer",
      "endpoints",
      "logging",
      "mcp",
      "module",
      "requests",
      "server",
      "source",
    ],
  },
  {
    sourceRoot: "packages/cli/src",
    files: ["index.ts", "version.ts"],
    directories: ["agent", "bundler", "commands", "contracts", "generation", "library"],
  },
  {
    sourceRoot: "packages/testing/src",
    files: ["index.ts"],
    directories: ["application", "overrides"],
  },
  {
    sourceRoot: "packages/graphql/src",
    files: ["index.ts"],
    directories: ["endpoint", "module"],
  },
  {
    sourceRoot: "packages/mcp/src",
    files: ["index.ts"],
    directories: ["prompts", "protocol", "resources", "server", "tools"],
  },
  {
    sourceRoot: "packages/openapi/src",
    files: ["index.ts"],
    directories: ["document", "module"],
  },
  {
    sourceRoot: "packages/opentelemetry/src",
    files: ["index.ts"],
    directories: ["module", "tracing"],
  },
  {
    sourceRoot: "packages/aponiajs/src",
    files: ["index.ts"],
    directories: [],
  },
  {
    sourceRoot: "packages/auth/src",
    files: ["index.ts"],
    directories: [
      "authentication",
      "authorization",
      "jwt",
      "module",
      "oidc",
      "password",
      "refresh",
      "revocation",
    ],
  },
  {
    sourceRoot: "packages/audit/src",
    files: ["index.ts"],
    directories: ["module", "service", "store"],
  },
  {
    sourceRoot: "packages/database/src",
    files: ["index.ts"],
    directories: ["database", "migration", "module", "repository"],
  },
  {
    sourceRoot: "packages/idempotency/src",
    files: ["index.ts"],
    directories: ["module", "runtime", "store"],
  },
  {
    sourceRoot: "packages/metrics/src",
    files: ["index.ts"],
    directories: ["module", "registry", "runtime"],
  },
  {
    sourceRoot: "packages/microservices/src",
    files: ["index.ts"],
    directories: ["brokers", "client", "envelope", "module", "server", "transport"],
  },
  {
    sourceRoot: "packages/serverless/src",
    files: ["index.ts"],
    directories: ["fetch", "lambda"],
  },
  { sourceRoot: "packages/h3/src", files: ["index.ts"], directories: [] },
  { sourceRoot: "packages/hono/src", files: ["index.ts"], directories: [] },
  { sourceRoot: "packages/nitro/src", files: ["index.ts"], directories: [] },
  {
    sourceRoot: "packages/queue/src",
    files: ["index.ts"],
    directories: ["module", "outbox", "queue"],
  },
  {
    sourceRoot: "packages/tenancy/src",
    files: ["index.ts"],
    directories: ["guard", "module", "service"],
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
