import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface GenerateProjectOptions {
  readonly name: string;
  readonly cwd?: string;
  readonly dryRun?: boolean;
  readonly skipInstall?: boolean;
}

export interface GenerateProjectResult {
  readonly projectDirectory: string;
  readonly files: readonly string[];
  readonly installed: boolean;
  readonly dryRun: boolean;
}

const projectNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export async function generateProject(
  options: GenerateProjectOptions,
): Promise<GenerateProjectResult> {
  validateProjectName(options.name);

  const workingDirectory = options.cwd ?? process.cwd();
  const projectDirectory = join(workingDirectory, options.name);
  const templateDirectory = fileURLToPath(new URL("../templates/application", import.meta.url));
  const templateFiles = await listFiles(templateDirectory);
  const relativeFiles = templateFiles.map((file) => outputPath(relative(templateDirectory, file)));

  if (options.dryRun) {
    return {
      projectDirectory,
      files: relativeFiles,
      installed: false,
      dryRun: true,
    };
  }

  if (await Bun.file(projectDirectory).exists()) {
    throw new Error(`Target directory "${basename(projectDirectory)}" already exists.`);
  }

  await mkdir(projectDirectory, { recursive: false });
  for (const templateFile of templateFiles) {
    const relativeFile = outputPath(relative(templateDirectory, templateFile));
    const outputFile = join(projectDirectory, relativeFile);
    const template = await Bun.file(templateFile).text();
    const output = template.replaceAll("{{PROJECT_NAME}}", options.name);

    await mkdir(dirname(outputFile), { recursive: true });
    await Bun.write(outputFile, output);
  }

  const shouldInstall = !options.skipInstall;
  if (shouldInstall) {
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

  return {
    projectDirectory,
    files: relativeFiles,
    installed: shouldInstall,
    dryRun: false,
  };
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
