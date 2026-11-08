import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";

const cliDocumentation = [
  "README.md",
  "docs/cli.md",
  "docs/packages.md",
  "packages/cli/README.md",
] as const;

/** Packages whose README must lead with module registration and a boot. */
const modulePackages = [
  "audit",
  "auth",
  "cache",
  "compression",
  "cron",
  "cors",
  "database",
  "devtools",
  "events",
  "graphql",
  "http",
  "idempotency",
  "metrics",
  "openapi",
  "opentelemetry",
  "queue",
  "rate-limit",
  "security",
  "session",
  "tenancy",
] as const;

/** Adapter packages that keep the raw-plugin path in a final section. */
const adapterPackages = ["cron", "cors", "graphql", "openapi", "opentelemetry"] as const;

/**
 * Documents that mention `application.get` only in prose, not in a runnable
 * snippet. A snippet must show where the application came from.
 */
const applicationAccessAllowlist = new Map([
  ["docs/cli.md", "the reference describes the generated main.ts in prose"],
  ["docs/plugin-packages.md", "the authoring guide discusses the read-back API"],
]);

describe("CLI documentation", () => {
  test("uses the globally installed aponia command consistently", async () => {
    const documents = await Promise.all(cliDocumentation.map((path) => Bun.file(path).text()));

    for (const content of documents) {
      expect(content).not.toContain("bunx aponia");
      expect(content).not.toContain("bun add --dev @aponiajs/cli");
      expect(content).toContain("bun add --global @aponiajs/cli");
    }
  });
});

describe("framework-first package documentation", () => {
  test("every module package README registers the module and boots the application", async () => {
    for (const name of modulePackages) {
      const content = await Bun.file(`packages/${name}/README.md`).text();
      expect(content, `${name}: module registration`).toContain("Module.register");
      expect(content, `${name}: boot`).toContain("AponiaFactory.create");
    }
  });

  test("adapter READMEs lead with usage and keep the native path last", async () => {
    for (const name of adapterPackages) {
      const content = await Bun.file(`packages/${name}/README.md`).text();
      expect(content, `${name}: legacy heading`).not.toContain(
        "## What this package is, and what it is not",
      );
      const usage = content.indexOf("## Use it");
      const escape = content.indexOf("## Native escape hatch");
      expect(usage, `${name}: Use it section`).toBeGreaterThanOrEqual(0);
      expect(escape, `${name}: Native escape hatch section`).toBeGreaterThan(usage);
    }
  });

  test("an application access snippet shows how the application was created", async () => {
    const repositoryRoot = resolve(import.meta.dir, "..");
    const documents = new Set<string>();
    for (const pattern of ["packages/*/README.md", "docs/*.md"]) {
      for await (const path of new Glob(pattern).scan({ cwd: repositoryRoot, onlyFiles: true })) {
        documents.add(path);
      }
    }

    for (const path of documents) {
      if (applicationAccessAllowlist.has(path)) {
        continue;
      }
      const content = await Bun.file(resolve(repositoryRoot, path)).text();
      for (const block of content.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)) {
        const snippet = block[1] ?? "";
        if (snippet.includes("application.get(")) {
          expect(snippet, `${path}: application access needs a boot`).toContain(
            "AponiaFactory.create",
          );
        }
      }
    }
  });
});
