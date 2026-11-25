import { resolve } from "node:path";
import { loadCliConfiguration, mergeConfiguration } from "../generation/cli-configuration.ts";
import { resolveProject } from "../generation/project-configuration.ts";
import type { AponiaCliConfiguration } from "../interfaces/cli-configuration.interface.ts";
import type { StartCommandOptions } from "../interfaces/command.interface.ts";

/**
 * Runs one application entrypoint without opening a server of its own.
 *
 * The project is resolved from `aponia-cli.json`, so a workspace application
 * starts from its own root under the configured `exec`.
 *
 * @param options - The entry, watcher, inspector, project, and production switches.
 * @returns The exit code the runtime reported.
 */
export async function runStartCommand(options: StartCommandOptions): Promise<number> {
  const root = resolve(options.cwd ?? process.cwd());
  const configuration = await readStartConfiguration(root, options.config);
  // `nest start <app>` names a configured project; an application that has no
  // project by that name keeps reading the positional as an entry file, which
  // is the Aponia shape the command has always documented.
  const projectName =
    options.project ??
    (options.entry !== undefined && configuration.projects?.[options.entry] !== undefined
      ? options.entry
      : undefined);
  const project = resolveProject(configuration, projectName);
  const workingDirectory = project.root === undefined ? root : resolve(root, project.root);
  const exec = options.exec ?? project.exec ?? configuration.exec ?? "bun";
  const entryFile =
    (projectName === undefined ? options.entry : undefined) ??
    project.entryFile ??
    configuration.entryFile ??
    "main";
  const file = options.path ?? entryPath(entryFile, options.prod === true);
  const arguments_: string[] = [exec];

  if (exec === "bun") {
    if (options.watch) {
      arguments_.push("--watch");
    }
    if (options.debug) {
      arguments_.push("--inspect");
    }
  }
  arguments_.push(file);

  const child = Bun.spawn(arguments_, {
    cwd: workingDirectory,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return await child.exited;
}

function entryPath(entry: string, prod: boolean): string {
  const hasExtension = /\.[cm]?[jt]s$/.test(entry);
  if (prod) {
    return hasExtension ? entry : `dist/${entry}.js`;
  }
  if (hasExtension || entry.includes("/")) {
    return entry;
  }
  return `src/${entry}.ts`;
}

async function readStartConfiguration(
  root: string,
  config: string | undefined,
): Promise<AponiaCliConfiguration> {
  if (config === undefined) {
    return (await loadCliConfiguration(root)).configuration;
  }
  const file = Bun.file(resolve(root, config));
  if (!(await file.exists())) {
    throw new Error(`Could not find configuration "${config}".`);
  }
  return mergeConfiguration((await file.json()) as Record<string, unknown>, "aponia-cli.json");
}
