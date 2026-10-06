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
      mcp: await packWorkspace("packages/mcp", archiveDirectory, "04-mcp", bunTemporaryDirectory),
      devtools: await packWorkspace(
        "packages/devtools",
        archiveDirectory,
        "05-devtools",
        bunTemporaryDirectory,
      ),
      cli: await packWorkspace("packages/cli", archiveDirectory, "06-cli", bunTemporaryDirectory),
      createAponia: await packWorkspace(
        "packages/create-aponia",
        archiveDirectory,
        "07-create-aponia",
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
    expect(generatedManifest.dependencies["@aponiajs/mcp"]).toBeUndefined();
    // The starter's `src/main.ts` mounts the devtools through the factory's
    // `plugins` option, so the application depends on it at run time.
    expect(generatedManifest.dependencies["@aponiajs/devtools"]).toBe(workspaceManifest.version);
    // The starter's build script registers the packed plugin, so the CLI is a
    // build-time dependency of every generated application.
    expect(generatedManifest.devDependencies["@aponiajs/cli"]).toBe(workspaceManifest.version);

    const localPackages = [
      ["@aponiajs/common", "dependencies", archives.common],
      ["@aponiajs/core", "dependencies", archives.core],
      ["@aponiajs/platform-elysia", "dependencies", archives.platformElysia],
      ["@aponiajs/devtools", "dependencies", archives.devtools],
      ["@aponiajs/cli", "devDependencies", archives.cli],
    ] as const;
    const localOverrides = [["@aponiajs/mcp", archives.mcp]] as const;
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
    for (const [packageName, archive] of localOverrides) {
      localManifest = applyEdits(
        localManifest,
        modify(localManifest, ["overrides", packageName], `file:${archive}`, {
          formattingOptions: {
            eol: "\n",
            insertSpaces: true,
            tabSize: 2,
          },
        }),
      );
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
    // The configured case: the lane reserves a port and passes it as `PORT`, the
    // variable the starter's schema declares, so the port the application takes
    // is the one the configuration validated.
    await expectServer(projectDirectory, "src/main.ts", await reservePort());
    // The same boot with `PORT` absent. This lane does not choose the port here —
    // it reserves one only for the configured case above: the schema's own default
    // is `3000`, and this case therefore needs `3000` free. A runner already
    // holding it fails the case by name, because the failure reports the port it
    // fetched and the application cannot take it.
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

    await expectServer(projectDirectory, "dist/main.js", await reservePort());
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
  await assertPackageDependency(
    join(projectDirectory, "node_modules/@aponiajs/devtools/package.json"),
    "@aponiajs/mcp",
    version,
  );
  await assertPackageDependency(
    join(projectDirectory, "node_modules/@aponiajs/mcp/package.json"),
    "@aponiajs/common",
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

/**
 * The address the absent case fetches, which is the starter's own default for
 * `PORT`, spelled literally like every other name this lane reads.
 *
 * It is the fallback the generated application's `src/config.ts` declares: the
 * lane names no port for that case, so the application takes `3000` and this
 * constant is how the fetch finds it. The configured case beside it reserves an
 * ephemeral port instead and never names one.
 */
const starterDefaultPort = 3000;

/**
 * Boots an application and asserts that it answers.
 *
 * `configuredPort` is the value the lane passes as `PORT` — the variable the
 * starter's schema declares — and omitting it is the other half of the same
 * contract: the lane passes nothing, the schema applies its own default, and
 * `starterDefaultPort` is the address the fetch for it uses.
 */
async function expectServer(
  projectDirectory: string,
  entrypoint: string,
  configuredPort?: number,
): Promise<void> {
  const port = configuredPort ?? starterDefaultPort;

  const environment: Record<string, string | undefined> = {
    ...Bun.env,
    // The starter serves the devtools unless `NODE_ENV` is `production`, and
    // this case is asserting that it does. Stated rather than inherited,
    // because the lane's own environment would otherwise decide it.
    NODE_ENV: "development",
  };
  if (configuredPort === undefined) {
    // Absent rather than inherited: this is the case where the schema's default
    // is the port, and a `PORT` the lane happens to hold would answer for it.
    delete environment.PORT;
  } else {
    environment.PORT = String(configuredPort);
  }

  const server = Bun.spawn([process.execPath, entrypoint], {
    cwd: projectDirectory,
    env: environment,
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
        `Generated application did not start successfully from "${entrypoint}" on port ${port}.\n` +
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

    // The two assertions above are one promise and this is the other half of it:
    // a starter that declared the devtools as a module import would decline its
    // own root and lose the line above, so the surface answering here is what
    // says the option path mounted it *and* the root stayed declarable. The
    // request goes to the same server this case already booted, because the
    // surface is mounted on the application's own port — and the generated
    // starter declares no route under `/__devtools`, so this `200` is the
    // plugin's mount rather than an application route answering in its place.
    const meta = await waitForAnswer(`http://127.0.0.1:${port}/__devtools/meta`);

    // The number is the devtools wire contract this release speaks, spelled
    // literally like every other name in this lane: the file exercises the packed
    // CLI the way an application does, so it reads the endpoint rather than a
    // constant imported from the package that serves it.
    expect(((await meta.json()) as { readonly contract: number }).contract).toBe(3);
  } finally {
    server.kill();
    await server.exited;
  }
}

/**
 * A port nothing holds, taken the way the lane takes the application's own. Bun
 * types a server's port as optional — a unix socket has none — so a case that
 * needs the number states that it read one rather than defaulting it.
 */
async function reservePort(): Promise<number> {
  const reservation = Bun.serve({
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  await reservation.stop(true);

  if (port === undefined) {
    throw new Error("the reservation bound no port to take.");
  }

  return port;
}

/**
 * One address, fetched until it answers.
 *
 * A socket is started by a process this lane does not control, so the first poll
 * may arrive before it is listening; the last failure is rethrown rather than a
 * rewritten message, because it is the one that says why.
 */
async function waitForAnswer(url: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      return response;
    } catch (error) {
      lastError = error;
      await Bun.sleep(20);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`No answer from ${url}.`);
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
