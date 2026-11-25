import { resolve } from "node:path";
import { formatBuildReport } from "../generation/build-report.ts";
import { generateInvokers } from "../generation/invoker-generator.ts";
import { generateProject } from "../generation/project-generator.ts";
import { checkLibrary } from "../library/check-library.ts";
import { searchLibraries, searchRemoteLibraries } from "../library/catalog.ts";
import { generateSchematic } from "../generation/schematic-generator.ts";
import { frameworkContract } from "../contracts/framework-contract.ts";
import { initAgent } from "../agent/init-agent.ts";
import { aponiaVersion } from "../version.ts";
import { parseArguments } from "./arguments.ts";
import { runDevServer } from "./dev-server.ts";
import { helpText } from "./help-text.ts";
import { runInfoCommand } from "./info.ts";
import { runStartCommand } from "./start-server.ts";
import {
  mergeConfiguration,
  readConfiguration,
  assertSupportedBuilder,
} from "../generation/cli-configuration.ts";
import {
  applySchematicSchema,
  findSchematic,
  readSchematicSchema,
  resolveCollection,
  runSchematic,
} from "../generation/schematic-collection.ts";
import type { AponiaCliConfiguration } from "../interfaces/cli-configuration.interface.ts";
import type { AddCommandOptions, BuildCommandOptions } from "../interfaces/command.interface.ts";

const addSchematicNames = ["ng-add", "nest-add", "add"] as const;

/**
 * Runs the CLI from parsed arguments to printed change lines.
 *
 * Prints `CREATE`/`UPDATE` lines and returns an exit code — it never throws.
 * A generation failure rejects the build rather than reporting and skipping.
 *
 * @param arguments_ - The raw command-line arguments, without the binary name.
 * @returns The process exit code: `0` on success, non-zero on failure.
 *
 * @example
 * ```ts
 * const code = await runCli(["generate", "controller", "users"]);
 * ```
 */
export async function runCli(arguments_: readonly string[]): Promise<number> {
  try {
    const command = parseArguments(arguments_);

    if (command.command === "help") {
      console.log(helpText);
      return 0;
    }

    if (command.command === "version") {
      console.log(aponiaVersion);
      return 0;
    }

    if (command.command === "generate") {
      const result = await generateSchematic(command);
      for (const change of result.changes) {
        console.log(`${change.kind} ${change.path}`);
      }
      return 0;
    }

    if (command.command === "build") {
      return await runBuildCommand(command);
    }

    if (command.command === "add") {
      return await runAddCommand(command);
    }

    if (command.command === "dev") {
      return await runDevServer(command.entry);
    }

    if (command.command === "start") {
      return await runStartCommand(command);
    }

    if (command.command === "info") {
      await runInfoCommand(command);
      return 0;
    }

    if (command.command === "library") {
      if (command.action === "new") {
        const result = await generateSchematic({
          command: "generate",
          schematic: command.kind === "plugin" ? "plugin" : "library",
          name: command.name ?? "",
          dryRun: false,
          skipImport: false,
          crud: false,
          type: "rest",
          publish: true,
          scope: command.scope,
          skipInstall: command.skipInstall ?? false,
          interactive: false,
          standalone: true,
        });
        for (const change of result.changes) {
          console.log(`${change.kind} ${change.path}`);
        }
        return 0;
      }
      if (command.action === "publish") {
        const checked = await checkLibrary({ path: command.path, publish: true });
        if (!checked.ok) {
          for (const issue of checked.issues) {
            console.error(issue);
          }
          return 1;
        }
        const build = Bun.spawnSync(["bun", "run", "build"], {
          cwd: checked.directory,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        if (build.exitCode !== 0) {
          return build.exitCode;
        }
        const pack = Bun.spawnSync(["npm", "pack", "--dry-run"], {
          cwd: checked.directory,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        if (pack.exitCode !== 0) {
          return pack.exitCode;
        }
        if (command.yes !== true) {
          const tag = command.tag ? ` --tag ${command.tag}` : "";
          console.log(
            `Library is ready to publish. Run: (cd ${checked.directory} && npm publish --access public${tag})`,
          );
          return 0;
        }
        const publish = Bun.spawnSync(
          ["npm", "publish", "--access", "public", ...(command.tag ? ["--tag", command.tag] : [])],
          {
            cwd: checked.directory,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          },
        );
        return publish.exitCode;
      }
      if (command.action === "search") {
        const local = searchLibraries(command.query);
        const entries = command.remote
          ? [
              ...local,
              ...(await searchRemoteLibraries(command.query)).filter(
                (remote) => !local.some((entry) => entry.name === remote.name),
              ),
            ]
          : local;
        if (command.json) {
          console.log(JSON.stringify(entries));
        } else if (entries.length === 0) {
          console.log("No libraries matched.");
        } else {
          for (const entry of entries) {
            console.log(`${entry.name} [${entry.kind}] — ${entry.description}`);
          }
        }
        return 0;
      }
      const result = await checkLibrary({
        path: command.path,
        publish: command.publish,
      });
      if (command.json) {
        console.log(JSON.stringify(result));
      } else if (result.ok) {
        console.log(`Library is valid: ${result.directory}`);
      } else {
        console.log(`Library check failed: ${result.directory}`);
        for (const issue of result.issues) {
          console.log(`  - ${issue}`);
        }
      }
      return result.ok ? 0 : 1;
    }

    if (command.command === "manifest") {
      console.log(JSON.stringify(frameworkContract, undefined, 2));
      return 0;
    }

    if (command.command === "agent") {
      const result = await initAgent({
        cwd: command.cwd,
        clients: command.clients,
        dryRun: command.dryRun,
      });
      for (const change of result.changes) {
        console.log(`${change.kind} ${change.path}`);
      }
      return 0;
    }

    const result = await generateProject(command);
    if (result.dryRun) {
      console.log(`CREATE ${result.projectDirectory}`);
      for (const file of result.files) {
        console.log(`  ${file}`);
      }
      return 0;
    }

    console.log(`Created ${command.name}`);
    console.log(`Next: cd ${command.directory ?? command.name} && bun run dev`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Aponia CLI error: ${message}`);
    return 1;
  }
}

async function runBuildCommand(command: BuildCommandOptions): Promise<number> {
  const root = resolve(process.cwd());
  const configuration = await readBuildConfiguration(root, command.config);
  assertSupportedBuilder(configuration.compilerOptions ?? {});

  const projects = command.all
    ? Object.entries(configuration.projects ?? {})
    : [
        [
          command.project ?? "",
          command.project ? configuration.projects?.[command.project] : undefined,
        ] as const,
      ];

  if (command.all && projects.length === 0) {
    throw new Error('No projects are configured; "--all" has nothing to build.');
  }

  for (const [name, project] of projects) {
    if (project === undefined && command.project !== undefined) {
      throw new Error(`Unknown project "${name}" in aponia-cli.json.`);
    }
    const directory =
      command.path === undefined
        ? project?.root === undefined
          ? root
          : resolve(root, project.root)
        : resolve(root, command.path);
    const arguments_ = ["bun", "run", "build"];
    if (command.watch) {
      arguments_.push("--watch");
    }
    if (command.typeCheck === true) {
      arguments_.push("--type-check");
    }
    if (command.typeCheck === false) {
      arguments_.push("--no-type-check");
    }
    if (command.emitDeclarations) {
      arguments_.push("--emit-declarations");
    }
    if (command.builder !== undefined) {
      arguments_.push("--builder", command.builder);
    }

    if (!(await hasBuildScript(directory))) {
      // A project without its own build script is the pre-bundler shape: `aponia
      // build` still writes the generated modules in place, as it always did.
      const result = await generateInvokers({
        cwd: directory,
        dryRun: command.dryRun,
        project: name === "" ? undefined : name,
      });
      for (const line of formatBuildReport(result)) {
        console.log(line);
      }
      if (!command.dryRun) {
        console.log(
          "Next: import it in your entrypoint and pass its controllerInvokers to AponiaFactory.create.",
        );
      }
      continue;
    }

    if (command.dryRun) {
      console.log(`${arguments_.join(" ")} (${directory})`);
      continue;
    }

    const child = Bun.spawn(arguments_, {
      cwd: directory,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      return exitCode;
    }
  }

  return 0;
}

async function hasBuildScript(directory: string): Promise<boolean> {
  const manifest = Bun.file(resolve(directory, "package.json"));
  if (!(await manifest.exists())) {
    return false;
  }
  try {
    const parsed = (await manifest.json()) as { readonly scripts?: Record<string, unknown> };
    return typeof parsed.scripts?.build === "string" && parsed.scripts.build.length > 0;
  } catch {
    return false;
  }
}

async function readBuildConfiguration(
  root: string,
  config: string | undefined,
): Promise<AponiaCliConfiguration> {
  if (config === undefined) {
    return readConfiguration(root);
  }
  const file = Bun.file(resolve(root, config));
  if (!(await file.exists())) {
    throw new Error(`Could not find configuration "${config}".`);
  }
  return mergeConfiguration((await file.json()) as Record<string, unknown>, "aponia-cli.json");
}

async function runAddCommand(command: AddCommandOptions): Promise<number> {
  const root = resolve(process.cwd());
  const resolved = await resolveCollection(root, command.library);
  const schematic = addSchematicNames
    .map((name) => {
      try {
        return findSchematic(resolved, name);
      } catch {
        return undefined;
      }
    })
    .find((entry) => entry !== undefined);
  if (schematic === undefined) {
    throw new Error(
      `The package "${command.library}" publishes no add schematic. Expected one of: ${addSchematicNames.join(", ")}.`,
    );
  }

  const schema = await readSchematicSchema(resolved, schematic.entry);
  const options = schema === undefined ? {} : applySchematicSchema(schema, {});
  const plan = await runSchematic(resolved, schematic, options);

  for (const file of plan.files) {
    const target = resolve(root, file.path);
    if (!command.dryRun) {
      await Bun.write(target, file.content);
    }
    console.log(`CREATE ${file.path}`);
  }

  if (!command.dryRun && !command.skipInstall) {
    const install = Bun.spawn(["bun", "install"], {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await install.exited) !== 0) {
      throw new Error("The package manager failed after adding the package.");
    }
  }

  return 0;
}
