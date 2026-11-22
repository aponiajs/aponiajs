import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSchematic } from "../src/generation/schematic-generator.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aponia-mcp-"));
  roots.push(root);
  await Bun.write(
    join(root, "aponia.json"),
    JSON.stringify({ sourceRoot: "src", generateOptions: { spec: true } }, undefined, 2),
  );
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({ name: "app", dependencies: {} }, undefined, 2),
  );
  await Bun.write(
    join(root, "src", "app.module.ts"),
    `import { Module } from "@aponiajs/common";

@Module({})
export class AppModule {}
`,
  );
  return root;
}

describe("aponia g mcp", () => {
  test("generates a tools provider and wires the module", async () => {
    const root = await createProject();

    await generateSchematic({
      command: "generate",
      schematic: "mcp",
      name: "orders",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      cwd: root,
    });

    expect(await Bun.file(join(root, "src/orders/orders.tools.ts")).exists()).toBe(true);
    expect(await Bun.file(join(root, "src/orders/orders.module.ts")).exists()).toBe(true);
    expect(await Bun.file(join(root, "src/orders/orders.tools.spec.ts")).exists()).toBe(true);

    const moduleSource = await Bun.file(join(root, "src/app.module.ts")).text();
    expect(moduleSource).toContain("OrdersModule");
    expect(moduleSource).toContain("McpModule.forRoot");
  });

  test("skips the spec when the project default says so", async () => {
    const root = await createProject();

    await generateSchematic({
      command: "generate",
      schematic: "mcp",
      name: "orders",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      spec: false,
      cwd: root,
    });

    expect(await Bun.file(join(root, "src/orders/orders.tools.spec.ts")).exists()).toBe(false);
  });
});
