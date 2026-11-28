import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { aponiaVersion } from "../version.ts";
import { loadCliConfiguration } from "../generation/cli-configuration.ts";
import {
  configurationFileName,
  legacyConfigurationFileName,
} from "../generation/cli-configuration.constants.ts";
import type { InfoCommandOptions } from "../interfaces/command.interface.ts";

/** What `aponia info` reports. */
interface ProjectInfo {
  readonly name: string;
  readonly type: string;
  readonly root: string;
  readonly sourceRoot: string;
}

/** The one object both output forms read. */
interface EnvironmentInfo {
  readonly cli: string;
  readonly framework: string | null;
  readonly bun: string;
  readonly os: string;
  readonly root: string;
  readonly configuration: string | null;
  readonly projects: readonly ProjectInfo[];
  readonly packageManager: string;
  readonly lockfile: string | null;
  readonly vitePlus: string | null;
  readonly git: { readonly branch: string; readonly commit: string } | null;
}

/**
 * Reports the toolchain, workspace, and project layout.
 *
 * @param options - The project root and output form.
 */
export async function runInfoCommand(options: InfoCommandOptions): Promise<void> {
  const info = await readInfo(resolve(options.cwd ?? process.cwd()));

  if (options.json) {
    console.log(JSON.stringify(info, undefined, 2));
    return;
  }

  console.log(`Aponia CLI     ${info.cli}`);
  console.log(`Framework      ${info.framework ?? "not installed"}`);
  console.log(`Bun            ${info.bun}`);
  console.log(`OS             ${info.os}`);
  console.log(`Workspace      ${info.root}`);
  console.log(`Configuration  ${info.configuration ?? "none"}`);
  console.log(`Package manager${info.packageManager} (${info.lockfile ?? "no lockfile"})`);
  console.log(`Vite+          ${info.vitePlus ?? "not installed"}`);
  if (info.git !== null) {
    console.log(`Git            ${info.git.branch} ${info.git.commit}`);
  }
  if (info.projects.length > 0) {
    console.log("Projects");
    for (const project of info.projects) {
      console.log(`  ${project.name}  ${project.type}  ${project.root}  ${project.sourceRoot}`);
    }
  }
}

async function readInfo(root: string): Promise<EnvironmentInfo> {
  const packageJson = await readJson(resolve(root, "package.json"));
  const loaded = await loadCliConfiguration(root).catch(() => undefined);
  const configuration = loaded?.configuration;
  const projects: ProjectInfo[] = [];
  const configured = configuration?.projects;

  if (typeof configured === "object" && configured !== null && !Array.isArray(configured)) {
    for (const [name, value] of Object.entries(configured)) {
      if (typeof value !== "object" || value === null) {
        continue;
      }
      const project = value as Record<string, unknown>;
      projects.push({
        name,
        type: typeof project.type === "string" ? project.type : "application",
        root: typeof project.root === "string" ? project.root : name,
        sourceRoot:
          typeof project.sourceRoot === "string"
            ? project.sourceRoot
            : `${typeof project.root === "string" ? project.root : name}/src`,
      });
    }
  }

  const configurationPath = [configurationFileName, legacyConfigurationFileName]
    .map((name) => resolve(root, name))
    .find((path) => existsSync(path));

  return {
    cli: aponiaVersion,
    framework: frameworkVersion(packageJson),
    bun: Bun.version,
    os: `${process.platform} ${process.arch}`,
    root,
    configuration: configurationPath ?? null,
    projects: Object.freeze(projects),
    packageManager:
      typeof packageJson?.packageManager === "string" ? packageJson.packageManager : "bun",
    lockfile: ["bun.lock", "bun.lockb"].find((name) => existsSync(resolve(root, name))) ?? null,
    vitePlus: dependencyVersion(packageJson, "vite-plus"),
    git: readGit(root),
  };
}

/**
 * The framework release an application declares.
 *
 * The platform package is what an application installs for the runtime, so it
 * is read first; `common` is the fallback for an application that declares
 * only the authoring package.
 */
function frameworkVersion(manifest: Record<string, unknown> | undefined): string | null {
  return (
    dependencyVersion(manifest, "@aponiajs/platform-elysia") ??
    dependencyVersion(manifest, "@aponiajs/common")
  );
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  try {
    return (await file.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function dependencyVersion(
  manifest: Record<string, unknown> | undefined,
  name: string,
): string | null {
  for (const key of ["dependencies", "devDependencies"] as const) {
    const section = manifest?.[key];
    if (typeof section === "object" && section !== null) {
      const value = (section as Record<string, unknown>)[name];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return null;
}

function readGit(root: string): { readonly branch: string; readonly commit: string } | null {
  const branch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: root });
  const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: root });

  if (branch.exitCode !== 0 || commit.exitCode !== 0) {
    return null;
  }

  return {
    branch: branch.stdout.toString().trim(),
    commit: commit.stdout.toString().trim(),
  };
}
