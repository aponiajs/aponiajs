import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { resolve } from "node:path";

const cliDocumentation = [
  "README.md",
  "docs/tooling/cli.md",
  "docs/reference/packages.md",
  "packages/cli/README.md",
] as const;

/** How each module package is used, which decides the README blocks it must show. */
type UsageTier = "service" | "guard" | "policy" | "route";

const packageUsageTiers: ReadonlyMap<string, UsageTier> = new Map([
  ["auth", "guard"],
  ["cache", "service"],
  ["compression", "policy"],
  ["cors", "policy"],
  ["cron", "service"],
  ["database", "service"],
  ["devtools", "policy"],
  ["events", "service"],
  ["graphql", "route"],
  ["http", "service"],
  ["mcp", "route"],
  ["openapi", "route"],
  ["queue", "service"],
  ["rate-limit", "guard"],
  ["security", "policy"],
  ["session", "service"],
  ["view", "service"],
  ["microservices", "service"],
]);

/**
 * Packages whose module deliberately refuses an async registration. The README
 * must state the refusal instead of showing a form the module does not export.
 */
const asyncRefusalPackages = new Set(["auth", "cron"]);

/** Adapter packages that keep the raw-plugin path in a final section. */
const adapterPackages = ["cron", "cors", "graphql", "mcp", "openapi"] as const;

function typescriptFences(content: string): readonly string[] {
  return [...content.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)].map(
    (match) => match[1] ?? "",
  );
}

function hasDecoratedFence(content: string, decorator: string): boolean {
  return typescriptFences(content).some((block) => block.includes(`${decorator}(`));
}

async function registrationMethods(name: string): Promise<ReadonlySet<string>> {
  const methods = new Set<string>();
  const repositoryRoot = resolve(import.meta.dir, "..");
  for await (const path of new Glob(`packages/${name}/src/**/*.module.ts`).scan({
    cwd: repositoryRoot,
    onlyFiles: true,
  })) {
    const source = await Bun.file(resolve(repositoryRoot, path)).text();
    for (const match of source.matchAll(
      /static\s+(?:override\s+)?(forRootAsync|registerAsync|registerQueueAsync|forRoot|register|forFeature|registerQueue)\s*[<(]/g,
    )) {
      if (match[1] !== undefined) {
        methods.add(match[1]);
      }
    }
  }
  return methods;
}

/**
 * Reports the usage blocks a package README is missing for its tier.
 *
 * @param content - The README text.
 * @param tier - How the package is consumed.
 * @param methods - The static registration methods its module exports.
 * @param refusesAsync - Whether the module deliberately refuses async registration.
 * @returns Missing block names, in contract order.
 */
function usageIssues(
  content: string,
  tier: UsageTier,
  methods: ReadonlySet<string>,
  refusesAsync: boolean,
): readonly string[] {
  const issues: string[] = [];

  if (!content.includes("Module.register") && !content.includes("Module.forRoot")) {
    issues.push("module registration");
  }

  const hasController = hasDecoratedFence(content, "@Controller");
  const hasResolver = hasDecoratedFence(content, "@Resolver");
  if (tier === "route" ? !hasController && !hasResolver : !hasController) {
    issues.push("controller example");
  }

  if ((tier === "service" || tier === "guard") && !hasDecoratedFence(content, "@Injectable")) {
    issues.push("service example");
  }

  if (tier === "guard" && !content.includes("@UseGuards(")) {
    issues.push("guard example");
  }

  if (
    tier === "policy" &&
    !/no service is injected|does not provide an injectable service/i.test(content)
  ) {
    issues.push("policy-only statement");
  }

  if (
    !refusesAsync &&
    (methods.has("forRootAsync") || methods.has("registerAsync")) &&
    !content.includes("forRootAsync") &&
    !content.includes("registerAsync")
  ) {
    issues.push("async registration");
  }

  if (refusesAsync && !/does not support|no asynchronous|not applicable/i.test(content)) {
    issues.push("async refusal statement");
  }

  return Object.freeze(issues);
}

/**
 * Documents that mention `application.get` only in prose, not in a runnable
 * snippet. A snippet must show where the application came from.
 */
const applicationAccessAllowlist = new Map([
  ["docs/tooling/cli.md", "the reference describes the generated main.ts in prose"],
  ["docs/tooling/plugin-packages.md", "the authoring guide discusses the read-back API"],
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
  test("every module package README shows its full usage surface", async () => {
    for (const [name, tier] of packageUsageTiers) {
      const content = await Bun.file(`packages/${name}/README.md`).text();
      const methods = await registrationMethods(name);
      expect(
        usageIssues(content, tier, methods, asyncRefusalPackages.has(name)),
        `${name}: README usage surface`,
      ).toEqual([]);
      expect(content, `${name}: boot`).toContain("AponiaFactory.create");
    }
  });

  test("a README missing a required usage block is refused", () => {
    const moduleOnly = [
      "## Use it",
      "```ts",
      "@Module({ imports: [CacheModule.forRoot()] })",
      "export class AppModule {}",
      "```",
      "## Bootstrap",
      "```ts",
      "const application = await AponiaFactory.create(AppModule);",
      "```",
    ].join("\n");

    expect(usageIssues(moduleOnly, "service", new Set(["forRoot"]), false)).toEqual([
      "controller example",
      "service example",
    ]);
    expect(usageIssues(moduleOnly, "policy", new Set(["forRoot"]), false)).toEqual([
      "controller example",
      "policy-only statement",
    ]);
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
    for (const pattern of ["packages/*/README.md", "docs/**/*.md"]) {
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
