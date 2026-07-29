import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyEdits, modify } from "jsonc-parser";

const workspaceDirectory = resolve(import.meta.dir, "../../..");

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

test("packed workspaces generate an application that installs, validates, builds, and starts", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "aponia-generated-e2e-"));

  try {
    const archiveDirectory = join(temporaryDirectory, "archives");
    const runnerDirectory = join(temporaryDirectory, "runner");
    await Promise.all([
      mkdir(archiveDirectory, { recursive: true }),
      mkdir(runnerDirectory, { recursive: true }),
    ]);

    const archives = {
      common: await packWorkspace("packages/common", archiveDirectory, "01-common"),
      core: await packWorkspace("packages/core", archiveDirectory, "02-core"),
      platformElysia: await packWorkspace(
        "packages/platform-elysia",
        archiveDirectory,
        "03-platform-elysia",
      ),
      cli: await packWorkspace("packages/cli", archiveDirectory, "04-cli"),
      createAponia: await packWorkspace(
        "packages/create-aponia",
        archiveDirectory,
        "05-create-aponia",
      ),
    } as const;
    const workspaceManifest = (await Bun.file(join(workspaceDirectory, "package.json")).json()) as {
      readonly version: string;
    };

    await Bun.write(
      join(runnerDirectory, "package.json"),
      `${JSON.stringify(
        {
          name: "aponia-generated-application-runner",
          private: true,
          dependencies: {
            "@aponiajs/cli": `file:${archives.cli}`,
            "create-aponia": `file:${archives.createAponia}`,
          },
          overrides: {
            "@aponiajs/cli": `file:${archives.cli}`,
          },
        },
        null,
        2,
      )}\n`,
    );
    await run(["bun", "install"], runnerDirectory);
    const cliEntryPoint = join(runnerDirectory, "node_modules/@aponiajs/cli/bin/aponia.ts");
    const versionResult = await run(["bun", cliEntryPoint, "--version"], runnerDirectory);
    expect(versionResult.stdout.trim()).toBe(workspaceManifest.version);
    await assertPackageDependency(
      join(runnerDirectory, "node_modules/create-aponia/package.json"),
      "@aponiajs/cli",
      workspaceManifest.version,
    );
    await run(
      [
        "bun",
        join(runnerDirectory, "node_modules/create-aponia/dist/create-aponia.mjs"),
        "generated-app",
        "--skip-install",
      ],
      runnerDirectory,
    );

    const projectDirectory = join(runnerDirectory, "generated-app");
    const resourceResult = await run(
      ["bun", cliEntryPoint, "generate", "resource", "users", "--type", "rest"],
      projectDirectory,
    );
    expect(resourceResult.stdout).toContain("CREATE src/users/users.model.ts");
    expect(await Bun.file(join(projectDirectory, "src/users/users.model.ts")).exists()).toBe(true);
    expect(await Bun.file(join(projectDirectory, "src/users/users.schema.ts")).exists()).toBe(
      false,
    );

    const generatedManifestPath = join(projectDirectory, "package.json");
    const generatedManifest = (await Bun.file(generatedManifestPath).json()) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };

    expect(generatedManifest.dependencies["@aponiajs/common"]).toBe(workspaceManifest.version);
    expect(generatedManifest.dependencies["@aponiajs/platform-elysia"]).toBe(
      workspaceManifest.version,
    );
    expect(generatedManifest.dependencies["@aponiajs/core"]).toBeUndefined();

    const localPackages = [
      ["@aponiajs/common", archives.common],
      ["@aponiajs/core", archives.core],
      ["@aponiajs/platform-elysia", archives.platformElysia],
    ] as const;
    let localManifest = await Bun.file(generatedManifestPath).text();
    for (const section of ["dependencies", "overrides"] as const) {
      for (const [packageName, archive] of localPackages) {
        localManifest = applyEdits(
          localManifest,
          modify(localManifest, [section, packageName], `file:${archive}`, {
            formattingOptions: {
              eol: "\n",
              insertSpaces: true,
              tabSize: 2,
            },
          }),
        );
      }
    }
    await Bun.write(generatedManifestPath, localManifest);

    await run(["bun", "install"], projectDirectory);
    await assertInstalledPackageGraph(projectDirectory, workspaceManifest.version);
    await run(
      [join(projectDirectory, "node_modules/.bin/vp"), "fmt", "package.json"],
      projectDirectory,
    );
    await run(["bun", "run", "check"], projectDirectory);
    await run(["bun", "test"], projectDirectory);
    await run(["bun", "run", "test:e2e"], projectDirectory);
    await run(["bun", "run", "build"], projectDirectory);
    await expectBuiltServer(projectDirectory);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}, 120_000);

async function packWorkspace(
  workspacePath: string,
  archiveDirectory: string,
  orderDirectory: string,
): Promise<string> {
  const destination = join(archiveDirectory, orderDirectory);
  await mkdir(destination, { recursive: true });
  await run(
    [
      "bun",
      "pm",
      "pack",
      "--cwd",
      join(workspaceDirectory, workspacePath),
      "--destination",
      destination,
      "--ignore-scripts",
      "--quiet",
    ],
    workspaceDirectory,
  );

  const archives = (await readdir(destination)).filter((file) => file.endsWith(".tgz"));
  if (archives.length !== 1 || !archives[0]) {
    throw new Error(`Expected one package archive in ${destination}, found ${archives.length}.`);
  }
  return join(destination, archives[0]);
}

async function assertInstalledPackageGraph(
  projectDirectory: string,
  version: string,
): Promise<void> {
  await assertPackageDependency(
    join(projectDirectory, "node_modules/@aponiajs/core/package.json"),
    "@aponiajs/common",
    version,
  );
  await assertPackageDependency(
    join(projectDirectory, "node_modules/@aponiajs/platform-elysia/package.json"),
    "@aponiajs/common",
    version,
  );
  await assertPackageDependency(
    join(projectDirectory, "node_modules/@aponiajs/platform-elysia/package.json"),
    "@aponiajs/core",
    version,
  );
}

async function assertPackageDependency(
  manifestPath: string,
  dependency: string,
  version: string,
): Promise<void> {
  const manifest = (await Bun.file(manifestPath).json()) as {
    readonly dependencies: Readonly<Record<string, string>>;
  };
  expect(manifest.dependencies[dependency]).toBe(version);
}

async function expectBuiltServer(projectDirectory: string): Promise<void> {
  const reservation = Bun.serve({
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  await reservation.stop(true);

  const server = Bun.spawn([process.execPath, "dist/main.js"], {
    cwd: projectDirectory,
    env: {
      ...Bun.env,
      PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(server.stdout).text();
  const stderr = new Response(server.stderr).text();

  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Hello from generated-app!");
        return;
      } catch {
        if (server.exitCode !== null) {
          break;
        }
        await Bun.sleep(50);
      }
    }

    throw new Error(
      `Generated application did not start successfully.\nstdout:\n${await stdout}\nstderr:\n${await stderr}`,
    );
  } finally {
    server.kill();
    await server.exited;
  }
}

async function run(command: readonly string[], cwd: string): Promise<CommandResult> {
  const bunTemporaryDirectory = join(cwd, ".tmp");
  await mkdir(bunTemporaryDirectory, { recursive: true });
  const executableCommand =
    command[0] === "bun" ? [process.execPath, ...command.slice(1)] : [...command];
  const subprocess = Bun.spawn(executableCommand, {
    cwd,
    env: {
      ...Bun.env,
      BUN_TMPDIR: bunTemporaryDirectory,
      CI: "true",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${command.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  return { stdout, stderr };
}
