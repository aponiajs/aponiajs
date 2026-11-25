import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { collectionAliases, collectionSchematicNames, parseFactoryReference } from "../index.ts";
import type { SchematicCollection } from "../index.ts";

const packageRoot = join(import.meta.dir, "..", "..");

async function readCollection(): Promise<SchematicCollection> {
  return (await Bun.file(join(packageRoot, "collection.json")).json()) as SchematicCollection;
}

describe("the schematic collection", () => {
  test("publishes the verified Nest names and aliases", async () => {
    const collection = await readCollection();

    expect(collectionSchematicNames(collection)).toEqual([
      "application",
      "class",
      "configuration",
      "controller",
      "decorator",
      "filter",
      "gateway",
      "guard",
      "interceptor",
      "interface",
      "library",
      "middleware",
      "module",
      "pipe",
      "provider",
      "resolver",
      "resource",
      "service",
      "sub-app",
      "upgrade",
    ]);
    expect(collectionAliases(collection)).toEqual({
      app: "sub-app",
      cl: "class",
      co: "controller",
      config: "configuration",
      d: "decorator",
      f: "filter",
      ga: "gateway",
      gu: "guard",
      itc: "interceptor",
      itf: "interface",
      lib: "library",
      mi: "middleware",
      mo: "module",
      pi: "pipe",
      pr: "provider",
      r: "resolver",
      res: "resource",
      s: "service",
      update: "upgrade",
    });
    expect(Object.keys(collection.schematics)).not.toContain("enum");
    expect(Object.keys(collection.schematics)).not.toContain("test");
    expect(Object.keys(collection.schematics)).not.toContain("dto");
  });

  test("points every factory and schema at the built output it publishes", async () => {
    const collection = await readCollection();

    for (const [name, entry] of Object.entries(collection.schematics)) {
      const factory = parseFactoryReference(entry.factory);
      expect(factory.path).toBe(`./dist/lib/${name}/${name}.factory.js`);
      expect(entry.schema).toBe(`./dist/lib/${name}/schema.json`);
      expect(
        await Bun.file(join(packageRoot, "src", "lib", name, `${name}.factory.ts`)).exists(),
      ).toBe(true);
      expect(await Bun.file(join(packageRoot, "src", "lib", name, "schema.json")).exists()).toBe(
        true,
      );
    }
  });

  test("resolves every collection path once the package is built", async () => {
    const builtIndex = join(packageRoot, "dist", "index.js");
    if (!(await Bun.file(builtIndex).exists())) {
      // The default test lane runs without building; `bun run build` is what
      // makes the collection's published paths exist, and `prepublishOnly`
      // runs it. There is nothing to resolve until that has happened.
      return;
    }

    const collection = await readCollection();
    for (const entry of Object.values(collection.schematics)) {
      const factory = parseFactoryReference(entry.factory);
      expect(await Bun.file(join(packageRoot, factory.path)).exists()).toBe(true);
      if (entry.schema !== undefined) {
        expect(await Bun.file(join(packageRoot, entry.schema)).exists()).toBe(true);
      }
    }
  });

  test("publishes a template directory per schematic", async () => {
    const collection = await readCollection();

    for (const name of Object.keys(collection.schematics)) {
      const directory = join(packageRoot, "src", "lib", name, "files");
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      if (name === "upgrade") {
        expect(entries).toEqual([]);
        continue;
      }
      expect(entries.length).toBeGreaterThan(0);
    }
  });
});
