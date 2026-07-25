import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateProject, parseArguments } from "../src/index.ts";

test("parses Nest-style new aliases and safety options", () => {
  expect(parseArguments(["n", "sample-api", "-d", "-s"])).toEqual({
    command: "new",
    name: "sample-api",
    dryRun: true,
    skipInstall: true,
  });
});

test("generates a module-controller-service application", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "aponia-cli-"));
  const result = await generateProject({
    name: "sample-api",
    cwd: temporaryDirectory,
    skipInstall: true,
  });
  const projectDirectory = join(temporaryDirectory, "sample-api");

  expect(result.installed).toBe(false);
  expect(await Bun.file(join(projectDirectory, "src/main.ts")).text()).toContain(
    "AponiaFactory.create(AppModule)",
  );
  expect(await Bun.file(join(projectDirectory, ".gitignore")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/app.module.ts")).text()).toContain(
    "controllers: [AppController]",
  );
  expect(await Bun.file(join(projectDirectory, "src/app.controller.ts")).text()).toContain(
    "@Controller()",
  );
  expect(await Bun.file(join(projectDirectory, "src/app.controller.ts")).text()).toContain(
    "@Get()",
  );
  expect(await Bun.file(join(projectDirectory, "src/app.controller.spec.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "test/app.e2e-spec.ts")).exists()).toBe(true);
  expect(await Bun.file(join(projectDirectory, "src/modules")).exists()).toBe(false);
});

test("dry-run does not create the target directory", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "aponia-dry-run-"));
  const result = await generateProject({
    name: "dry-api",
    cwd: temporaryDirectory,
    dryRun: true,
  });

  expect(result.files).toContain("src/main.ts");
  expect(await Bun.file(result.projectDirectory).exists()).toBe(false);
});
