import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { aponiaVersion } from "../version.ts";
import type { GenerateProjectOptions, GenerateProjectResult } from "./project-generator.types.ts";

const projectNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Generates a project from the starter template: names, versions, and
 * install state resolved, files planned or written.
 *
 * @param options - The project name and creation flags.
 * @returns The project directory, files, and install state.
 * @throws A plain `Error` for a project name outside the kebab-case shape.
 */
export async function generateProject(
  options: GenerateProjectOptions,
): Promise<GenerateProjectResult> {
  validateProjectName(options.name);

  const workingDirectory = options.cwd ?? process.cwd();
  const projectDirectory = join(workingDirectory, options.name);
  const templateDirectory = fileURLToPath(
    new URL("./templates/application/", import.meta.resolve("@aponiajs/cli/package.json")),
  );
  const templateFiles = await listFiles(templateDirectory);
  const workspace = options.workspace === true;
  const appPrefix = workspace ? "apps/api" : "";
  const relativeFiles = [
    ...templateFiles.map((file) =>
      workspace
        ? join(appPrefix, outputPath(relative(templateDirectory, file)))
        : outputPath(relative(templateDirectory, file)),
    ),
    ...(workspace ? Object.keys(workspaceRootFiles(options.name)) : []),
  ].toSorted();

  if (options.dryRun) {
    return {
      projectDirectory,
      files: relativeFiles,
      installed: false,
      dryRun: true,
    };
  }

  if (await pathExists(projectDirectory)) {
    throw new Error(`Target directory "${basename(projectDirectory)}" already exists.`);
  }

  await mkdir(projectDirectory, { recursive: false });
  try {
    for (const templateFile of templateFiles) {
      const relativeFile = workspace
        ? join(appPrefix, outputPath(relative(templateDirectory, templateFile)))
        : outputPath(relative(templateDirectory, templateFile));
      const outputFile = join(projectDirectory, relativeFile);
      const template = await Bun.file(templateFile).text();
      const output = renderTemplate(template, workspace ? "api" : options.name);

      await mkdir(dirname(outputFile), { recursive: true });
      await Bun.write(outputFile, output);
    }

    if (workspace) {
      for (const [relativeFile, content] of Object.entries(workspaceRootFiles(options.name))) {
        const outputFile = join(projectDirectory, relativeFile);
        await mkdir(dirname(outputFile), { recursive: true });
        await Bun.write(outputFile, content);
      }
    }

    if (!options.skipInstall) {
      const process = Bun.spawn(["bun", "install"], {
        cwd: projectDirectory,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await process.exited;
      if (exitCode !== 0) {
        throw new Error(`Bun install failed with exit code ${exitCode}.`);
      }
    }
  } catch (error) {
    await rm(projectDirectory, { recursive: true, force: true });
    throw error;
  }

  const installed = !options.skipInstall;
  return {
    projectDirectory,
    files: relativeFiles,
    installed,
    dryRun: false,
  };
}

function workspaceRootFiles(projectName: string): Readonly<Record<string, string>> {
  return {
    "package.json": `${JSON.stringify(
      {
        name: projectName,
        version: "0.0.1",
        private: true,
        type: "module",
        workspaces: ["apps/*", "libs/*"],
        scripts: {
          dev: "bun run --filter api dev",
          build: "bun run --workspaces build",
          test: "bun test",
          check: "vp check",
        },
        devDependencies: { "vite-plus": "^1.5.0" },
      },
      undefined,
      2,
    )}\n`,
    "aponia.json": `${JSON.stringify(
      {
        projects: {
          api: { root: "apps/api", sourceRoot: "src" },
        },
        generateOptions: { spec: true },
      },
      undefined,
      2,
    )}\n`,
    "README.md": `# ${projectName}\n\nAn AponiaJS workspace. Applications live under \`apps/\` and shared libraries under \`libs/\`.\n`,
    "AGENTS.md": `# ${projectName}\n\nRead the [AponiaJS repository guide](https://github.com/aponiajs/aponiajs/blob/release/alpha/AGENTS.md). Product code lives in \`apps/\`; reusable modules live in \`libs/\`.\n`,
    ".gitignore": "node_modules\ndist\n.env\n*.log\n",
    "libs/.gitkeep": "",
  };
}

function renderTemplate(template: string, projectName: string): string {
  return template
    .replaceAll("{{PROJECT_NAME}}", projectName)
    .replaceAll("{{APONIA_VERSION}}", aponiaVersion);
}

function outputPath(templatePath: string): string {
  if (templatePath === "_gitignore") {
    return ".gitignore";
  }

  return templatePath.endsWith(".tmpl") ? templatePath.slice(0, -5) : templatePath;
}

function validateProjectName(name: string): void {
  if (!projectNamePattern.test(name)) {
    throw new Error("Project name must use lowercase kebab-case and start with a letter.");
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? listFiles(path) : [path];
      }),
  );

  return files.flat();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
