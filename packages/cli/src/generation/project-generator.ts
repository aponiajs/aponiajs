import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { aponiaVersion } from "../version.ts";
import type { GenerateProjectOptions, GenerateProjectResult } from "./project-generator.types.ts";

const projectNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export async function generateProject(
  options: GenerateProjectOptions,
): Promise<GenerateProjectResult> {
  validateProjectName(options.name);

  const workingDirectory = options.cwd ?? process.cwd();
  const projectDirectory = join(workingDirectory, options.name);
  const templateDirectory = fileURLToPath(new URL("../../templates/application", import.meta.url));
  const templateFiles = await listFiles(templateDirectory);
  const relativeFiles = templateFiles
    .map((file) => outputPath(relative(templateDirectory, file)))
    .toSorted();

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
      const relativeFile = outputPath(relative(templateDirectory, templateFile));
      const outputFile = join(projectDirectory, relativeFile);
      const template = await Bun.file(templateFile).text();
      const output = renderTemplate(template, options.name);

      await mkdir(dirname(outputFile), { recursive: true });
      await Bun.write(outputFile, output);
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
