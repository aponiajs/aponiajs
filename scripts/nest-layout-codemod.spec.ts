import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  chooseSpecDirectory,
  computeSourceTarget,
  computeTestTarget,
  findUnmovedImports,
  findUnresolvedLinks,
  layoutMapPath,
  moveFiles,
  planLayout,
  renderLayoutPlan,
  runCodemod,
  transformFileName,
} from "./nest-layout-codemod.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aponia-layout-"));
  temporaryDirectories.push(directory);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(directory, path);
    await Bun.$`mkdir -p ${join(absolute, "..")}`.quiet();
    await Bun.write(absolute, contents);
  }
  return directory;
}

async function expectRefusal(action: Promise<unknown>, fragment: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    expect((error as Error).message).toContain(fragment);
    return;
  }
  throw new Error(`Expected a refusal naming ${fragment}.`);
}

function workspace(files: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return {
    "packages/alpha/package.json": '{ "name": "@aponiajs/alpha" }\n',
    "packages/alpha/src/index.ts":
      'export { AlphaModule } from "./module/alpha-module.ts";\nexport { AlphaService } from "./service/alpha-service.ts";\nexport type { AlphaOptions } from "./store/alpha-store.types.ts";\n',
    "packages/alpha/src/module/alpha-module.ts":
      'import { AlphaService } from "../service/alpha-service.ts";\nimport type { AlphaOptions } from "../store/alpha-store.types.ts";\nexport class AlphaModule {}\nexport type { AlphaOptions };\nvoid AlphaService;\n',
    "packages/alpha/src/service/alpha-service.ts":
      'import type { AlphaOptions } from "../store/alpha-store.types.ts";\nexport class AlphaService {\n  readonly options: AlphaOptions | undefined = undefined;\n}\n',
    "packages/alpha/src/store/alpha-store.ts":
      'export class AlphaStore {\n  readonly label = "alpha";\n}\n',
    "packages/alpha/src/store/alpha-store.types.ts":
      "export interface AlphaOptions {\n  readonly label: string;\n}\n",
    "packages/alpha/tests/alpha-module.test.ts":
      'import { test } from "bun:test";\nimport { AlphaModule } from "../src/index.ts";\ntest("loads", () => {\n  expect(AlphaModule).toBeDefined();\n});\n',
    "packages/alpha/tests/fixtures/helper.ts": "export const helper = 1;\n",
    "packages/alpha/tests-vp/alpha.conformance.ts":
      'import { test } from "vitest";\nimport { AlphaModule } from "../src/index.ts";\ntest("loads", () => {\n  expect(AlphaModule).toBeDefined();\n});\n',
    "docs/alpha.md":
      "See `packages/alpha/src/module/alpha-module.ts` and `packages/alpha/tests/alpha-module.test.ts`.\n",
    ...files,
  };
}

describe("the layout naming contract", () => {
  test("normalizes a hyphenated kind suffix to the Nest dotted form", () => {
    expect(transformFileName("audit-module.ts")).toBe("audit.module.ts");
    expect(transformFileName("audit-service.ts")).toBe("audit.service.ts");
    expect(transformFileName("class-serializer-interceptor.ts")).toBe(
      "class-serializer.interceptor.ts",
    );
    expect(transformFileName("built-in-pipes.ts")).toBe("built-in.pipe.ts");
    expect(transformFileName("authorization.decorators.ts")).toBe("authorization.decorators.ts");
    expect(transformFileName("memory-cache-store.ts")).toBe("memory-cache.store.ts");
    expect(transformFileName("cache.module-definition.ts")).toBe("cache.module-definition.ts");
    expect(transformFileName("audit.constants.ts")).toBe("audit.constants.ts");
    expect(transformFileName("module.ts")).toBe("module.ts");
    expect(transformFileName("index.ts")).toBe("index.ts");
  });

  test("applies the directory rewrites the plan states", () => {
    expect(computeSourceTarget("common", "logging/console-logger.ts")).toBe(
      "packages/common/src/services/console-logger.service.ts",
    );
    expect(computeSourceTarget("common", "errors/aponia-error.ts")).toBe(
      "packages/common/src/exceptions/aponia-error.ts",
    );
    expect(computeSourceTarget("core", "graph/module-graph.ts")).toBe(
      "packages/core/src/scanner/module-graph.ts",
    );
    expect(computeSourceTarget("core", "container/container.ts")).toBe(
      "packages/core/src/injector/container.ts",
    );
    expect(computeSourceTarget("platform-core", "plugins/plugin-module.ts")).toBe(
      "packages/platform-core/src/platform/plugin.module.ts",
    );
    expect(computeSourceTarget("cache", "module/cache-module.ts")).toBe(
      "packages/cache/src/cache.module.ts",
    );
    expect(computeSourceTarget("auth", "authentication/auth.guard.ts")).toBe(
      "packages/auth/src/auth.guard.ts",
    );
  });

  test("lowers a type-only module to an interface in the interface directory", () => {
    expect(computeSourceTarget("common", "modules/module.types.ts")).toBe(
      "packages/common/src/interfaces/module.interface.ts",
    );
    expect(computeSourceTarget("core", "graph/graph.types.ts")).toBe(
      "packages/core/src/interfaces/graph.interface.ts",
    );
  });

  test("keeps a type-only module flat where the Nest counterpart is flat", () => {
    expect(computeSourceTarget("rate-limit", "module/rate-limit.types.ts")).toBe(
      "packages/rate-limit/src/module/rate-limit.interface.ts",
    );
  });

  test("keeps the type-only modules the counterpart keeps", () => {
    expect(computeSourceTarget("schematics", "lib/schematic.types.ts")).toBe(
      "packages/schematics/src/lib/schematic.types.ts",
    );
    expect(computeSourceTarget("platform-elysia", "plugins/plugin.types.ts")).toBe(
      "packages/platform-elysia/src/plugins/plugin.types.ts",
    );
  });

  test("takes an explicit override over the derived target", () => {
    expect(computeSourceTarget("common", "modules/configurable-module.ts")).toBe(
      "packages/common/src/module-utils/configurable-module.builder.ts",
    );
    expect(computeSourceTarget("http", "client/http-service.ts")).toBe(
      "packages/http/src/http-client.service.ts",
    );
    expect(
      computeSourceTarget("alpha", "module/alpha-module.ts", {
        "packages/alpha/src/module/alpha-module.ts": "packages/alpha/src/kept.ts",
      }),
    ).toBe("packages/alpha/src/kept.ts");
  });
});

describe("the colocated spec placement", () => {
  const index = [
    { slug: "alpha", directory: "" },
    { slug: "alpha-store", directory: "store" },
    { slug: "alpha-interface", directory: "interfaces" },
  ];

  test("prefers an exact match and the shallowest directory", () => {
    expect(chooseSpecDirectory("alpha", index)).toBe("");
    expect(chooseSpecDirectory("alpha-store", index)).toBe("store");
  });

  test("matches a test whose name extends a source name", () => {
    expect(chooseSpecDirectory("alpha-store-branches", index)).toBe("store");
  });

  test("never places a spec beside a type-only module", () => {
    expect(chooseSpecDirectory("alpha-interface", index)).toBe("");
  });

  test("falls back to a directory that carries the name, then to the source root", () => {
    expect(chooseSpecDirectory("store", index)).toBe("store");
    expect(chooseSpecDirectory("unrelated", index)).toBe("");
  });
});

describe("the test target", () => {
  const index = [{ slug: "alpha", directory: "" }];

  test("moves a conformance suite to test/", () => {
    expect(computeTestTarget("alpha", "tests-vp/alpha.conformance.ts", index)).toEqual({
      target: "packages/alpha/test/alpha.conformance.ts",
      category: "conformance",
    });
  });

  test("moves a CLI end-to-end suite to test/ with the Nest suffix", () => {
    expect(computeTestTarget("alpha", "e2e/generated.e2e.ts", index)).toEqual({
      target: "packages/alpha/test/generated.e2e-spec.ts",
      category: "e2e",
    });
  });

  test("keeps a live suite and a support file under test/", () => {
    expect(computeTestTarget("alpha", "tests/brokers.e2e-spec.ts", index).target).toBe(
      "packages/alpha/test/brokers.e2e-spec.ts",
    );
    expect(computeTestTarget("alpha", "tests/support/boot.ts", index).target).toBe(
      "packages/alpha/test/support/boot.ts",
    );
    expect(computeTestTarget("alpha", "tests/fixture.ts", index).target).toBe(
      "packages/alpha/test/fixture.ts",
    );
  });

  test("colocates a unit test beside the source it names", () => {
    expect(computeTestTarget("alpha", "tests/alpha-module.test.ts", index)).toEqual({
      target: "packages/alpha/src/alpha-module.spec.ts",
      category: "test",
    });
  });

  test("keeps a spec under test/ when the package has no source root", () => {
    expect(computeTestTarget("alpha", "tests/entrypoint.test.ts", index, false).target).toBe(
      "packages/alpha/test/entrypoint.spec.ts",
    );
  });
});

describe("the layout plan", () => {
  test("maps every source and test file and rewrites nothing on a dry run", async () => {
    const root = await createFixture(workspace({}));
    const plan = await planLayout(root);

    expect(plan.collisions).toEqual([]);
    expect(plan.multiKindFiles).toEqual([]);
    expect(plan.unmappedFiles).toEqual([]);
    expect(plan.moves).toContainEqual({
      from: "packages/alpha/src/module/alpha-module.ts",
      to: "packages/alpha/src/module/alpha.module.ts",
      category: "source",
    });
    expect(plan.moves).toContainEqual({
      from: "packages/alpha/src/store/alpha-store.types.ts",
      to: "packages/alpha/src/interfaces/alpha-store.interface.ts",
      category: "source",
    });
    expect(plan.moves).toContainEqual({
      from: "packages/alpha/tests-vp/alpha.conformance.ts",
      to: "packages/alpha/test/alpha.conformance.ts",
      category: "conformance",
    });
    expect(plan.directoryMoves).toContainEqual({
      from: "packages/core/src/graph",
      to: "packages/core/src/scanner",
    });

    const report = await runCodemod({ root, log: () => {} });
    expect(report.movedCount).toBe(plan.moves.length);
    expect(report.unmovedImports).toEqual([]);
    expect(await Bun.file(join(root, "packages/alpha/src/module/alpha-module.ts")).exists()).toBe(
      true,
    );
  });

  test("reports a collision instead of choosing a target", async () => {
    const root = await createFixture(
      workspace({
        "packages/alpha/src/module/alpha.module.ts": "export class AlphaModule {}\n",
      }),
    );
    const plan = await planLayout(root);

    expect(plan.collisions.map((collision) => collision.to)).toContain(
      "packages/alpha/src/module/alpha.module.ts",
    );
    await expectRefusal(moveFiles(root, plan), "collisions");
  });

  test("reports a collision and a multi-kind file through the entry function", async () => {
    const root = await createFixture(
      workspace({
        "packages/alpha/src/module/alpha.module.ts": "export class AlphaModule {}\n",
        "packages/alpha/src/service/beta-service.ts":
          "export class BetaModule {}\nexport class BetaService {}\n",
      }),
    );
    const messages: string[] = [];
    const report = await runCodemod({ root, log: (message) => messages.push(message) });

    expect(report.collisions.map((collision) => collision.to)).toContain(
      "packages/alpha/src/module/alpha.module.ts",
    );
    expect(report.multiKindFiles).toEqual(["packages/alpha/src/service/beta-service.ts"]);
    expect(messages.some((message) => message.startsWith("collision "))).toBe(true);
    expect(messages.some((message) => message.startsWith("multi-kind "))).toBe(true);
    expect(messages).toContain("Unmoved imports: 0");
  });

  test("refuses a file that exports two Nest kinds", async () => {
    const root = await createFixture(
      workspace({
        "packages/alpha/src/module/alpha-module.ts":
          "export class AlphaModule {}\nexport class AlphaService {}\n",
        "packages/alpha/src/fixture.spec.ts":
          "export class AlphaModule {}\nexport class AlphaService {}\n",
      }),
    );
    const plan = await planLayout(root);

    expect(plan.multiKindFiles).toEqual(["packages/alpha/src/module/alpha-module.ts"]);
    await expectRefusal(moveFiles(root, plan), "multi-kind");
  });

  test("serializes the committed map deterministically", async () => {
    const root = await createFixture(workspace({}));
    const plan = await planLayout(root);
    const rendered = renderLayoutPlan(plan);
    const parsed = JSON.parse(rendered) as {
      version: number;
      moves: readonly { from: string; to: string; category: string }[];
      typeOnlyExceptions: readonly string[];
    };

    expect(parsed.version).toBe(1);
    expect(parsed.moves.length).toBe(plan.moves.length);
    expect(parsed.moves).toEqual(
      [...parsed.moves].toSorted((left, right) => left.from.localeCompare(right.from)),
    );
    expect(parsed.typeOnlyExceptions).toEqual(
      expect.arrayContaining(["packages/schematics/src/lib/schematic.types.ts"]),
    );
    expect(renderLayoutPlan(await planLayout(root))).toBe(rendered);
  });
});

describe("applying the plan", () => {
  test("moves files, rewrites imports, and rewrites path references", async () => {
    const root = await createFixture(workspace({}));
    const report = await runCodemod({ root, apply: true, writeMap: true, log: () => {} });

    expect(report.unmovedImports).toEqual([]);
    expect(report.unresolvedLinks).toEqual([]);
    expect(report.collisions).toEqual([]);

    const index = await Bun.file(join(root, "packages/alpha/src/index.ts")).text();
    expect(index).toContain('from "./module/alpha.module.ts"');
    expect(index).toContain('from "./service/alpha.service.ts"');
    expect(index).toContain('from "./interfaces/alpha-store.interface.ts"');

    const module = await Bun.file(join(root, "packages/alpha/src/module/alpha.module.ts")).text();
    expect(module).toContain('from "../service/alpha.service.ts"');
    expect(module).toContain('from "../interfaces/alpha-store.interface.ts"');

    const colocated = (
      await readdir(join(root, "packages/alpha/src"), {
        recursive: true,
      })
    ).filter((path) => path.endsWith("alpha-module.spec.ts"));
    expect(colocated).toHaveLength(1);
    expect(await Bun.file(join(root, "packages/alpha/src", colocated[0]!)).text()).toContain(
      "index.ts",
    );

    expect(await Bun.file(join(root, "packages/alpha/test/alpha.conformance.ts")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(root, "packages/alpha/test/fixtures/helper.ts")).exists()).toBe(
      true,
    );

    const documentation = await Bun.file(join(root, "docs/alpha.md")).text();
    expect(documentation).toContain("packages/alpha/src/module/alpha.module.ts");
    expect(documentation).toContain("packages/alpha/src/store/alpha-module.spec.ts");

    const map = JSON.parse(await Bun.file(join(root, layoutMapPath)).text()) as {
      moves: readonly unknown[];
    };
    expect(map.moves.length).toBe(report.movedCount);

    expect(await Bun.file(join(root, "packages/alpha/tests/alpha-module.test.ts")).exists()).toBe(
      false,
    );
    expect(await Bun.file(join(root, "packages/alpha/tests")).exists()).toBe(false);
  });

  test("reports a relative import that the rewrite could not resolve", async () => {
    const root = await createFixture(
      workspace({
        "packages/alpha/src/broken.ts": 'import { missing } from "./missing.ts";\nvoid missing;\n',
      }),
    );
    expect(await findUnmovedImports(root)).toEqual([
      "packages/alpha/src/broken.ts -> ./missing.ts",
    ]);
  });

  test("reports a Markdown link that does not resolve", async () => {
    const root = await createFixture(
      workspace({
        "docs/broken.md": "[gone](./missing.md)\n",
      }),
    );
    expect(await findUnresolvedLinks(root)).toEqual(["docs/broken.md -> ./missing.md"]);
  });
});

describe("the entrypoint", () => {
  test("runs as a subprocess against a workspace root", async () => {
    const root = await createFixture(workspace({}));
    const script = join(import.meta.dir, "nest-layout-codemod.ts");
    const child = Bun.spawnSync({
      cmd: [process.execPath, script, "--apply", "--write-map", "--root", root],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toContain("Moved");
    const entries = await readdir(join(root, "packages/alpha/src/module"));
    expect(entries).toContain("alpha.module.ts");
  });
});
