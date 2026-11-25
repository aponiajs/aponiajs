import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySchematicSchema,
  findSchematic,
  readSchematicSchema,
  resolveCollection,
  runSchematic,
} from "./schematic-collection.ts";
import { generateSchematic } from "./schematic-generator.ts";
import { runCli } from "../index.ts";
import { aponiaVersion } from "../version.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aponia-collection-"));
  temporaryDirectories.push(root);
  await Bun.write(
    join(root, "aponia-cli.json"),
    JSON.stringify({ sourceRoot: "src", collection: "@aponiajs/schematics" }),
  );
  await mkdir(join(root, "src"), { recursive: true });
  return root;
}

async function writeFixtureCollection(root: string): Promise<void> {
  const directory = join(root, "fixture");
  await mkdir(directory, { recursive: true });
  await Bun.write(
    join(directory, "collection.json"),
    JSON.stringify({
      schematics: {
        controller: {
          factory: "./controller.factory.ts#main",
          description: "Create a fixture controller.",
          schema: "./controller.schema.json",
          aliases: ["co"],
        },
        "ng-add": {
          factory: "./add.factory.ts#main",
          description: "Add the fixture package.",
        },
      },
    }),
  );
  await Bun.write(
    join(directory, "controller.schema.json"),
    JSON.stringify({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        spec: { type: "boolean", default: true },
      },
    }),
  );
  await Bun.write(
    join(directory, "controller.factory.ts"),
    `export function main(options) { return { files: [{ path: \`src/\${options.name}.txt\`, content: "controller" }] }; }\n`,
  );
  await Bun.write(
    join(directory, "add.factory.ts"),
    `export function main() { return { files: [{ path: "src/added.txt", content: "added" }] }; }\n`,
  );
  await Bun.write(
    join(directory, "service.schema.json"),
    JSON.stringify({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        path: { type: "string" },
        spec: { type: "boolean", default: true },
        specFileSuffix: { type: "string", default: "spec" },
        flat: { type: "boolean", default: false },
      },
    }),
  );
  await Bun.write(
    join(directory, "service.factory.ts"),
    `export function main(options) {
  return {
    files: [
      {
        path: \`\${options.path}/\${options.name}.json\`,
        content: JSON.stringify({
          spec: options.spec,
          specFileSuffix: options.specFileSuffix,
          flat: options.flat,
          isEsm: options.isEsm,
        }),
      },
    ],
  };
}
`,
  );
  await Bun.write(
    join(directory, "options.schema.json"),
    JSON.stringify({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        path: { type: "string" },
        type: { type: "string" },
        crud: { type: "boolean" },
        isEsm: { type: "boolean" },
      },
    }),
  );
  await Bun.write(
    join(directory, "options.factory.ts"),
    `export function main(options) {
  return {
    files: [
      {
        path: \`\${options.path}/\${options.name}.json\`,
        content: JSON.stringify({
          type: options.type,
          crud: options.crud,
          isEsm: options.isEsm,
        }),
      },
    ],
  };
}
`,
  );
  await Bun.write(
    join(directory, "collection.json"),
    JSON.stringify({
      schematics: {
        application: {
          factory: "./options.factory.ts#main",
          description: "Create a fixture application.",
          schema: "./options.schema.json",
        },
        app: {
          factory: "./options.factory.ts#main",
          description: "Create a fixture workspace application.",
          schema: "./options.schema.json",
        },
        library: {
          factory: "./options.factory.ts#main",
          description: "Create a fixture library.",
          schema: "./options.schema.json",
        },
        resource: {
          factory: "./options.factory.ts#main",
          description: "Create a fixture resource.",
          schema: "./options.schema.json",
        },
        controller: {
          factory: "./controller.factory.ts#main",
          description: "Create a fixture controller.",
          schema: "./controller.schema.json",
          aliases: ["co"],
        },
        service: {
          factory: "./service.factory.ts#main",
          description: "Create a fixture service.",
          schema: "./service.schema.json",
          aliases: ["s"],
        },
        "ng-add": {
          factory: "./add.factory.ts#main",
          description: "Add the fixture package.",
        },
        escape: { factory: "../outside.factory.ts#main", description: "Escapes the package." },
        missingFactory: { factory: "./none.ts#main", description: "Missing factory." },
        wrongExport: { factory: "./controller.factory.ts#absent", description: "Missing export." },
        missingSchema: {
          factory: "./controller.factory.ts#main",
          description: "Missing schema.",
          schema: "./none.schema.json",
        },
      },
    }),
  );
}

test("refuses a factory that escapes its package, does not exist, or exports no function", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);
  const resolved = await resolveCollection(root, "./fixture");

  expect(runSchematic(resolved, findSchematic(resolved, "escape"), { name: "x" })).rejects.toThrow(
    "names a factory outside the package: ../outside.factory.ts.",
  );
  expect(
    runSchematic(resolved, findSchematic(resolved, "missingFactory"), { name: "x" }),
  ).rejects.toThrow("names a factory that does not exist: ./none.ts.");
  expect(
    runSchematic(resolved, findSchematic(resolved, "wrongExport"), { name: "x" }),
  ).rejects.toThrow("does not export a function.");
});

test("refuses a schema path that does not resolve", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);
  const resolved = await resolveCollection(root, "./fixture");

  expect(
    readSchematicSchema(resolved, findSchematic(resolved, "missingSchema").entry),
  ).rejects.toThrow("names a schema that does not exist: ./none.schema.json.");
});

test("resolves a named collection and its schematic aliases", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);

  const resolved = await resolveCollection(root, "./fixture");
  expect(resolved.name).toBe("./fixture");
  expect(findSchematic(resolved, "co").name).toBe("controller");
  expect(() => findSchematic(resolved, "missing")).toThrow(
    'The collection "./fixture" has no schematic "missing".',
  );
  expect(resolveCollection(root, "./missing")).rejects.toThrow(
    'Could not resolve the schematic collection "./missing".',
  );
});

test("applies a schematic schema's required properties and defaults", () => {
  const schema = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      spec: { type: "boolean", default: true },
      kind: { type: "string", enum: ["a", "b"] },
    },
  };

  expect(applySchematicSchema(schema, { name: "users" })).toEqual({ name: "users", spec: true });
  expect(() => applySchematicSchema(schema, {})).toThrow('The schematic requires "name".');
  expect(() => applySchematicSchema(schema, { name: "users", spec: "yes" })).toThrow(
    'The schematic option "spec" must be a boolean.',
  );
  expect(() => applySchematicSchema(schema, { name: "users", kind: "c" })).toThrow(
    'The schematic option "kind" must be one of: a, b.',
  );
});

test("runs an external collection factory and writes the files it plans", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);

  const result = await generateSchematic({
    command: "generate",
    schematic: "controller",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    collection: "./fixture",
    cwd: root,
  });

  expect(result.changes).toEqual([{ kind: "CREATE", path: "src/users.txt" }]);
  expect(await Bun.file(join(root, "src/users.txt")).text()).toBe("controller");
});

test("applies aponia-cli.json generateOptions to a collection schematic", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);
  await Bun.write(
    join(root, "aponia-cli.json"),
    JSON.stringify({
      sourceRoot: "src",
      collection: "./fixture",
      generateOptions: { spec: false, specFileSuffix: "test", flat: true, baseDir: "src/feature" },
    }),
  );

  const result = await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    collection: "./fixture",
    cwd: root,
  });

  expect(result.changes).toEqual([{ kind: "CREATE", path: "src/feature/users.json" }]);
  expect(JSON.parse(await Bun.file(join(root, "src/feature/users.json")).text())).toEqual({
    spec: false,
    specFileSuffix: "test",
    flat: true,
    isEsm: false,
  });
});

test("passes the project's module system to a collection schematic", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);
  await Bun.write(join(root, "package.json"), JSON.stringify({ type: "module" }));

  const result = await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    collection: "./fixture",
    cwd: root,
  });

  expect(result.changes).toEqual([{ kind: "CREATE", path: "src/users.json" }]);
  expect(JSON.parse(await Bun.file(join(root, "src/users.json")).text())).toMatchObject({
    isEsm: true,
  });
});

test("detects the module system from the manifest and tsconfig", async () => {
  const esmRoot = await createProject();
  await writeFixtureCollection(esmRoot);
  await Bun.write(join(esmRoot, "package.json"), "{ malformed");
  await Bun.write(
    join(esmRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "ESNext" } }),
  );
  await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    collection: "./fixture",
    cwd: esmRoot,
  });
  expect(JSON.parse(await Bun.file(join(esmRoot, "src/users.json")).text())).toMatchObject({
    isEsm: true,
  });

  const commonJsRoot = await createProject();
  await writeFixtureCollection(commonJsRoot);
  await Bun.write(
    join(commonJsRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "CommonJS" } }),
  );
  await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    collection: "./fixture",
    cwd: commonJsRoot,
  });
  expect(JSON.parse(await Bun.file(join(commonJsRoot, "src/users.json")).text())).toMatchObject({
    isEsm: false,
  });

  const unreadableRoot = await createProject();
  await writeFixtureCollection(unreadableRoot);
  await Bun.write(join(unreadableRoot, "tsconfig.json"), "{ malformed");
  await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    collection: "./fixture",
    cwd: unreadableRoot,
  });
  expect(JSON.parse(await Bun.file(join(unreadableRoot, "src/users.json")).text())).toMatchObject({
    isEsm: false,
  });
});

test("resolves the workspace folder each collection schematic owns", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);
  const common = {
    command: "generate" as const,
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest" as const,
    collection: "./fixture",
    cwd: root,
  };

  const application = await generateSchematic({
    ...common,
    schematic: "application",
    name: "demo",
    applicationType: "cjs",
  });
  expect(application.changes).toEqual([{ kind: "CREATE", path: "demo/demo.json" }]);
  expect(JSON.parse(await Bun.file(join(root, "demo/demo.json")).text())).toMatchObject({
    type: "cjs",
  });

  const app = await generateSchematic({ ...common, schematic: "app", name: "admin" });
  expect(app.changes).toEqual([{ kind: "CREATE", path: "apps/admin.json" }]);

  const library = await generateSchematic({ ...common, schematic: "library", name: "widgets" });
  expect(library.changes).toEqual([{ kind: "CREATE", path: "libs/widgets.json" }]);

  const resourcePlan = await generateSchematic({
    ...common,
    schematic: "resource",
    name: "users",
    type: "ws",
  });
  expect(resourcePlan.changes).toEqual([{ kind: "CREATE", path: "src/users.json" }]);
  expect(JSON.parse(await Bun.file(join(root, "src/users.json")).text())).toMatchObject({
    type: "ws",
    crud: false,
  });
});

test("refuses to overwrite a file a collection plans", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);
  await Bun.write(join(root, "src/users.txt"), "existing");

  expect(
    generateSchematic({
      command: "generate",
      schematic: "controller",
      name: "users",
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest",
      collection: "./fixture",
      cwd: root,
    }),
  ).rejects.toThrow('File "src/users.txt" already exists.');
});

test("refuses a missing collection or a missing schematic by name", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);

  expect(
    generateSchematic({
      command: "generate",
      schematic: "controller",
      name: "users",
      dryRun: true,
      skipImport: false,
      crud: false,
      type: "rest",
      collection: "./absent",
      cwd: root,
    }),
  ).rejects.toThrow('Could not resolve the schematic collection "./absent".');

  expect(
    generateSchematic({
      command: "generate",
      schematic: "mcp",
      name: "users",
      dryRun: true,
      skipImport: false,
      crud: false,
      type: "rest",
      collection: "./fixture",
      cwd: root,
    }),
  ).rejects.toThrow('The collection "./fixture" has no schematic "mcp".');
});

test("honors the spec file suffix", async () => {
  const root = await createProject();
  const result = await generateSchematic({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: true,
    skipImport: true,
    crud: false,
    type: "rest",
    specFileSuffix: "test",
    cwd: root,
  });

  expect(result.changes.map((change) => change.path)).toContain("src/users/users.service.test.ts");
});

test("refuses a JavaScript generation request by name", async () => {
  const root = await createProject();
  expect(
    generateSchematic({
      command: "generate",
      schematic: "service",
      name: "users",
      dryRun: true,
      skipImport: false,
      crud: false,
      type: "rest",
      language: "js",
      cwd: root,
    }),
  ).rejects.toThrow(
    'The Aponia generator emits TypeScript only; "--language js" is not supported.',
  );
});

test("upgrades the Aponia dependencies to the running release", async () => {
  const root = await createProject();
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({
      name: "sample",
      dependencies: { "@aponiajs/common": "0.0.1", react: "^18.0.0" },
      devDependencies: { "@aponiajs/cli": "0.0.1" },
    }),
  );

  const result = await generateSchematic({
    command: "generate",
    schematic: "upgrade",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    skipInstall: true,
    cwd: root,
  });

  expect(result.changes).toEqual([{ kind: "UPDATE", path: "package.json" }]);
  const manifest = (await Bun.file(join(root, "package.json")).json()) as {
    readonly dependencies: Readonly<Record<string, string>>;
    readonly devDependencies: Readonly<Record<string, string>>;
  };
  expect(manifest.dependencies["@aponiajs/common"]).toBe(aponiaVersion);
  expect(manifest.dependencies.react).toBe("^18.0.0");
  expect(manifest.devDependencies["@aponiajs/cli"]).toBe(aponiaVersion);
});

test("adds a package through its collection's add schematic", async () => {
  const root = await createProject();
  await writeFixtureCollection(root);
  const previous = process.cwd();
  process.chdir(root);
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((message) => {
    output.push(String(message));
  });

  try {
    expect(await runCli(["add", "./fixture", "--dry-run"])).toBe(0);
    expect(output).toEqual(["CREATE src/added.txt"]);
    expect(await Bun.file(join(root, "src/added.txt")).exists()).toBe(false);

    expect(await runCli(["add", "./fixture", "--skip-install"])).toBe(0);
    expect(await Bun.file(join(root, "src/added.txt")).text()).toBe("added");
  } finally {
    log.mockRestore();
    process.chdir(previous);
  }
});

test("refuses a package with no collection", async () => {
  const root = await createProject();
  const previous = process.cwd();
  process.chdir(root);
  const error = spyOn(console, "error").mockImplementation(() => {});

  try {
    expect(await runCli(["add", "./absent"])).toBe(1);
    expect(error.mock.calls[0]?.[0]).toContain(
      'Could not resolve the schematic collection "./absent".',
    );
  } finally {
    error.mockRestore();
    process.chdir(previous);
  }
});

test("writes the Aponia configuration and records a workspace application", async () => {
  const root = await createProject();
  await rm(join(root, "aponia-cli.json"));

  const configuration = await generateSchematic({
    command: "generate",
    schematic: "configuration",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    cwd: root,
  });
  expect(configuration.changes).toEqual([{ kind: "CREATE", path: "aponia-cli.json" }]);

  const application = await generateSchematic({
    command: "generate",
    schematic: "app",
    name: "admin",
    dryRun: false,
    skipImport: false,
    crud: false,
    type: "rest",
    cwd: root,
  });
  expect(application.changes.map((change) => change.path)).toContain(
    "apps/admin/tsconfig.app.json",
  );
  expect(await Bun.file(join(root, "apps/admin/tsconfig.app.json")).exists()).toBe(true);
  expect(await Bun.file(join(root, "apps/admin/tsconfig.json")).exists()).toBe(false);
  const loaded = (await Bun.file(join(root, "aponia-cli.json")).json()) as {
    readonly monorepo?: boolean;
    readonly projects?: Readonly<Record<string, { readonly type?: string }>>;
  };
  expect(loaded.monorepo).toBe(true);
  expect(loaded.projects?.admin?.type).toBe("application");
});
