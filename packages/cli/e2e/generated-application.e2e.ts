import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyEdits, modify } from "jsonc-parser";

const workspaceDirectory = resolve(import.meta.dir, "../../..");

/**
 * The generated modules a bundle writes beside the application's own sources.
 *
 * Spelled out rather than imported from the package: this lane exercises the
 * packed CLI the way an application does, and an application names these files
 * from the documentation, not from the package's own constants.
 */
const generatedArtifacts = ["src/invokers.generated.ts", "src/descriptors.generated.ts"] as const;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

test("packed workspaces generate an application that installs, validates, builds, and starts", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "aponia-generated-e2e-"));
  // Bun resolves a `file:` install into `BUN_TMPDIR` before it moves the
  // package into `node_modules`, and a package it leaves behind there is
  // type-checked as part of whatever directory it was staged under. Keeping the
  // temp directory outside every directory this lane runs a check in is what
  // keeps a packed workspace's own sources out of the application's check.
  const bunTemporaryDirectory = join(temporaryDirectory, "bun-tmp");

  try {
    const archiveDirectory = join(temporaryDirectory, "archives");
    const runnerDirectory = join(temporaryDirectory, "runner");
    await Promise.all([
      mkdir(archiveDirectory, { recursive: true }),
      mkdir(runnerDirectory, { recursive: true }),
    ]);

    const archives = {
      common: await packWorkspace(
        "packages/common",
        archiveDirectory,
        "01-common",
        bunTemporaryDirectory,
      ),
      core: await packWorkspace(
        "packages/core",
        archiveDirectory,
        "02-core",
        bunTemporaryDirectory,
      ),
      platformElysia: await packWorkspace(
        "packages/platform-elysia",
        archiveDirectory,
        "03-platform-elysia",
        bunTemporaryDirectory,
      ),
      cli: await packWorkspace("packages/cli", archiveDirectory, "04-cli", bunTemporaryDirectory),
      createAponia: await packWorkspace(
        "packages/create-aponia",
        archiveDirectory,
        "05-create-aponia",
        bunTemporaryDirectory,
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
    await run(["bun", "install"], runnerDirectory, bunTemporaryDirectory);
    const cliEntryPoint = join(runnerDirectory, "node_modules/@aponiajs/cli/bin/aponia.ts");
    const versionResult = await run(
      ["bun", cliEntryPoint, "--version"],
      runnerDirectory,
      bunTemporaryDirectory,
    );
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
      bunTemporaryDirectory,
    );

    const projectDirectory = join(runnerDirectory, "generated-app");
    const resourceResult = await run(
      ["bun", cliEntryPoint, "generate", "resource", "users", "--type", "rest"],
      projectDirectory,
      bunTemporaryDirectory,
    );
    expect(resourceResult.stdout).toContain("CREATE src/users/users.model.ts");
    expect(await Bun.file(join(projectDirectory, "src/users/users.model.ts")).exists()).toBe(true);
    expect(
      await Bun.file(join(projectDirectory, "src/users/dto/create-user.dto.ts")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(join(projectDirectory, "src/users/dto/update-user.dto.ts")).exists(),
    ).toBe(false);
    expect(await Bun.file(join(projectDirectory, "src/users/users.schema.ts")).exists()).toBe(
      false,
    );

    const webSocketResourceResult = await run(
      ["bun", cliEntryPoint, "generate", "resource", "events", "--type", "ws"],
      projectDirectory,
      bunTemporaryDirectory,
    );
    expect(webSocketResourceResult.stdout).toContain("CREATE src/events/events.gateway.ts");
    const generatedGateway = await Bun.file(
      join(projectDirectory, "src/events/events.gateway.ts"),
    ).text();
    expect(generatedGateway).toContain('@WebSocketGateway("/events")');
    expect(generatedGateway).toContain('@SubscribeMessage("events.create")');
    expect(generatedGateway).toContain('@SubscribeMessage("events.remove")');

    const generatedManifestPath = join(projectDirectory, "package.json");
    const generatedManifest = (await Bun.file(generatedManifestPath).json()) as {
      readonly dependencies: Readonly<Record<string, string>>;
      readonly devDependencies: Readonly<Record<string, string>>;
    };

    expect(generatedManifest.dependencies["@aponiajs/common"]).toBe(workspaceManifest.version);
    expect(generatedManifest.dependencies["@aponiajs/platform-elysia"]).toBe(
      workspaceManifest.version,
    );
    expect(generatedManifest.dependencies["@aponiajs/core"]).toBeUndefined();
    // The starter's build script registers the packed plugin, so the CLI is a
    // build-time dependency of every generated application.
    expect(generatedManifest.devDependencies["@aponiajs/cli"]).toBe(workspaceManifest.version);

    const localPackages = [
      ["@aponiajs/common", "dependencies", archives.common],
      ["@aponiajs/core", "dependencies", archives.core],
      ["@aponiajs/platform-elysia", "dependencies", archives.platformElysia],
      ["@aponiajs/cli", "devDependencies", archives.cli],
    ] as const;
    let localManifest = await Bun.file(generatedManifestPath).text();
    for (const [packageName, section, archive] of localPackages) {
      for (const target of [section, "overrides"] as const) {
        localManifest = applyEdits(
          localManifest,
          modify(localManifest, [target, packageName], `file:${archive}`, {
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

    await run(["bun", "install"], projectDirectory, bunTemporaryDirectory);
    await assertInstalledPackageGraph(projectDirectory, workspaceManifest.version);
    await run(
      [join(projectDirectory, "node_modules/.bin/vp"), "fmt", "package.json"],
      projectDirectory,
      bunTemporaryDirectory,
    );
    await run(["bun", "run", "check"], projectDirectory, bunTemporaryDirectory);
    await run(["bun", "test"], projectDirectory, bunTemporaryDirectory);
    await run(["bun", "run", "test:e2e"], projectDirectory, bunTemporaryDirectory);

    // The starter commits both generated modules, so the application has been
    // serving through generated route invokers since before this build: the
    // checks above, and the e2e suite inside them, ran on a project no build had
    // touched. Booting the sources here is what asserts that rather than
    // assuming it, and the startup line is what separates "the starter ships the
    // artifacts" from "the starter boots from them" — a starter that imported
    // them and never handed them over answers every request either way.
    for (const artifact of generatedArtifacts) {
      expect(await Bun.file(join(projectDirectory, artifact)).exists()).toBe(true);
    }
    await expectServer(projectDirectory, "src/main.ts");

    const buildResult = await run(["bun", "run", "build"], projectDirectory, bunTemporaryDirectory);
    // Regenerating is what a build does to modules that are already there, so
    // both are reported as updates rather than as creations. The change line is
    // what fails when the build stops regenerating them at all.
    for (const artifact of generatedArtifacts) {
      expect(buildResult.stdout).toContain(`UPDATE ${artifact}`);
      expect(await Bun.file(join(projectDirectory, artifact)).exists()).toBe(true);
    }
    // A build writes the generated modules beside the application's sources, so
    // the application's own check has to stay green afterwards.
    await run(["bun", "run", "check"], projectDirectory, bunTemporaryDirectory);

    await expectServer(projectDirectory, "dist/main.js");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}, 120_000);

async function packWorkspace(
  workspacePath: string,
  archiveDirectory: string,
  orderDirectory: string,
  bunTemporaryDirectory: string,
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
    bunTemporaryDirectory,
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

/**
 * The graph a generated application reports it booted from.
 *
 * `src/main.ts` names the decorated `AppModule` and hands over the descriptor
 * module the build committed beside it, so this line is the application saying
 * which of the two served it. It is logged while the application starts, before
 * the first request is answered.
 */
const descriptorStartupLine = "Booting AppModule from the generated module descriptors";

async function expectServer(projectDirectory: string, entrypoint: string): Promise<void> {
  const reservation = Bun.serve({
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  await reservation.stop(true);

  const server = Bun.spawn([process.execPath, entrypoint], {
    cwd: projectDirectory,
    env: {
      ...Bun.env,
      PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  // A server this lane starts is killed rather than exiting on its own, so both
  // streams are read as they arrive: awaiting one after the process ends would
  // mean waiting for the kill below.
  const stdout = captureStream(server.stdout);
  const stderr = captureStream(server.stderr);

  try {
    let answered = false;
    for (let attempt = 0; attempt < 100 && !answered; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Hello from generated-app!");
        answered = true;
      } catch {
        if (server.exitCode !== null) {
          break;
        }
        await Bun.sleep(50);
      }
    }

    if (!answered) {
      throw new Error(
        `Generated application did not start successfully from "${entrypoint}".\n` +
          `stdout:\n${stdout.text()}\nstderr:\n${stderr.text()}`,
      );
    }

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (stdout.text().includes(descriptorStartupLine)) {
        break;
      }
      await Bun.sleep(20);
    }
    expect(stdout.text()).toContain(descriptorStartupLine);
  } finally {
    server.kill();
    await server.exited;
  }
}

/**
 * A subprocess stream, captured as it arrives.
 *
 * The text a server wrote is only readable once its stream has ended, so a
 * long-running process needs the chunks collected while it runs rather than the
 * stream awaited.
 */
function captureStream(stream: ReadableStream<Uint8Array>): { readonly text: () => string } {
  const decoder = new TextDecoder();
  let captured = "";
  void (async () => {
    for await (const chunk of stream) {
      captured += decoder.decode(chunk, { stream: true });
    }
  })();

  return { text: () => captured };
}

async function run(
  command: readonly string[],
  cwd: string,
  bunTemporaryDirectory: string,
): Promise<CommandResult> {
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
