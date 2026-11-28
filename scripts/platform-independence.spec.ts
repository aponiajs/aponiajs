import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

/**
 * The three platform packages. A platform depends only on the shared packages
 * and its own runtime peer; it never depends on another platform.
 */
const platforms = ["platform-elysia", "platform-hono", "platform-h3"] as const;

/** The `@aponiajs/*` packages a platform may depend on. */
const sharedPackages = new Set(["@aponiajs/common", "@aponiajs/core"]);

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

async function readManifest(name: string): Promise<Manifest> {
  return (await Bun.file(`packages/${name}/package.json`).json()) as Manifest;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.ts");
  for await (const path of glob.scan({ cwd: root, onlyFiles: true })) {
    // A colocated spec may reach a sibling package's test support; the rule is
    // about the platform source an application loads, not about a test fixture.
    if (path.endsWith(".spec.ts")) {
      continue;
    }
    files.push(path);
  }
  return files;
}

describe("platform independence", () => {
  test("the platform family is exactly Elysia, Hono, and H3", async () => {
    const entries = await readdir("packages", { withFileTypes: true });
    const found = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("platform-"))
      .map((entry) => entry.name)
      .sort();

    expect(found).toEqual([...platforms].sort());
  });

  test("a platform depends on no other platform", async () => {
    for (const platform of platforms) {
      const manifest = await readManifest(platform);
      const declared = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ].filter((name) => name.startsWith("@aponiajs/"));

      for (const name of declared) {
        expect(sharedPackages.has(name), `${platform} depends on ${name}`).toBe(true);
      }
    }
  });

  test("platform source imports no other platform", async () => {
    for (const platform of platforms) {
      for (const file of await sourceFiles(`packages/${platform}/src`)) {
        const source = await Bun.file(`packages/${platform}/src/${file}`).text();
        const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

        for (const specifier of specifiers) {
          const own = `@aponiajs/${platform}`;
          if (specifier.startsWith("@aponiajs/platform-") && specifier !== own) {
            throw new Error(`${platform}/${file} imports ${specifier}`);
          }
          if (specifier.includes("/platform-") && specifier.startsWith("..")) {
            throw new Error(`${platform}/${file} reaches another platform through ${specifier}`);
          }
        }
      }
    }
  });

  test("the adapters page names the platform family and Nitro as a delivery adapter", async () => {
    const page = await Bun.file("docs/platforms/adapters.md").text();

    for (const platform of platforms) {
      expect(page).toContain(`@aponiajs/${platform}`);
    }
    expect(page).toContain("| `@aponiajs/nitro`           | Adapter  |");
    expect(page).not.toContain("@aponiajs/platform-nitro");
  });
});
