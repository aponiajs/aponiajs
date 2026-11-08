import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { frameworkContract } from "../packages/cli/src/contracts/framework-contract.ts";
import { schematicNames } from "../packages/cli/src/commands/command.constants.ts";
import { routeSchemaSlots } from "../packages/common/src/routing/route-schema.ts";

describe("framework contract", () => {
  test("matches the closed error union", async () => {
    const source = await Bun.file("packages/common/src/errors/aponia-error.types.ts").text();
    const codes = [...source.matchAll(/\|\s*"([A-Z0-9_]+)"/g)].map((match) => match[1]);

    expect(new Set(frameworkContract.errorCodes)).toEqual(new Set(codes));
  });

  test("accounts for every literal metadata key the runtime writes", async () => {
    const keys = new Set<string>();
    for (const root of ["packages/common/src", "packages/platform-elysia/src"]) {
      for (const file of await listTypeScriptFiles(root)) {
        const source = await Bun.file(file).text();
        for (const match of source.matchAll(/Symbol\.for\(\s*"([^"]+)"/g)) {
          keys.add(match[1]!);
        }
      }
    }

    expect(new Set(frameworkContract.metadataKeys)).toEqual(keys);
  });

  test("names every published workspace package", async () => {
    const names: string[] = [];
    for (const entry of await readdir("packages", { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const path = join("packages", entry.name, "package.json");
      const file = Bun.file(path);
      if (!(await file.exists())) {
        continue;
      }
      const manifest = (await file.json()) as {
        readonly name?: unknown;
        readonly private?: unknown;
      };
      if (manifest.private !== true && typeof manifest.name === "string") {
        names.push(manifest.name);
      }
    }

    expect(new Set(frameworkContract.packages)).toEqual(new Set(names));
  });

  test("repeats the route slots, schematics, lifecycle hooks, and version", async () => {
    expect(frameworkContract.routeSlots).toEqual([...routeSchemaSlots]);
    expect(frameworkContract.schematics).toEqual([...schematicNames]);

    const lifecycle = await Bun.file("packages/common/src/lifecycle/lifecycle.types.ts").text();
    for (const hook of frameworkContract.lifecycle) {
      expect(lifecycle).toContain(`${hook}(`);
    }

    const root = (await Bun.file("package.json").json()) as { readonly version?: unknown };
    expect(frameworkContract.frameworkVersion).toBe(String(root.version));
    expect(frameworkContract.versioningStrategies).toEqual(["uri", "header", "media-type"]);
    expect(frameworkContract.contractVersion).toBe(1);
  });

  test("names decorators the common package still exports", async () => {
    const source = (
      await Promise.all(
        (await listTypeScriptFiles("packages/common/src")).map((file) => Bun.file(file).text()),
      )
    ).join("\n");

    for (const decorator of frameworkContract.decorators) {
      expect(
        source.includes(`export function ${decorator}`) ||
          source.includes(`export const ${decorator}`),
        decorator,
      ).toBe(true);
    }
  });
});

async function listTypeScriptFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(path)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
