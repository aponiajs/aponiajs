import { lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { aponiaVersion } from "../version.ts";
import { agentGuideAliases } from "./file-writer.ts";
import { stripDevtoolsDocumentation } from "./no-observe-documentation.ts";
import { initAgent } from "../agent/init-agent.ts";
import type {
  GenerateProjectOptions,
  GenerateProjectResult,
} from "../interfaces/project-generator.interface.ts";

const projectNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const templateDirectories = {
  bun: "application",
  esm: "nest-esm",
  cjs: "nest-cjs",
} as const;

const canonicalTestRunners = {
  bun: "bun",
  esm: "vitest",
  cjs: "jest",
} as const;

/**
 * Generates a project from one of the starter template sets: names, versions,
 * and install state resolved, files planned or written.
 *
 * The Bun set is the default. The ESM and CJS sets are Nest-compatible: they
 * carry `.js` extensions and Vitest or Jest respectively, and the Bun set never
 * emits a `.js` extension.
 *
 * @param options - The project name and creation flags.
 * @returns The project directory, files, and install state.
 * @throws A plain `Error` for an invalid name or an incompatible runner.
 */
export async function generateProject(
  options: GenerateProjectOptions,
): Promise<GenerateProjectResult> {
  validateProjectName(options.name);
  const type = options.type ?? "bun";
  const testRunner = options.testRunner ?? canonicalTestRunners[type];
  if (testRunner !== canonicalTestRunners[type]) {
    throw new Error(
      `--type ${type} pairs with --test-runner ${canonicalTestRunners[type]}; "${testRunner}" is not supported for that template set.`,
    );
  }
  if (options.language !== undefined && options.language !== "ts") {
    throw new Error(
      'The Aponia generator emits TypeScript only; "--language js" is not supported.',
    );
  }
  if (options.minimal === true && type === "cjs") {
    throw new Error(
      "--type cjs cannot be combined with --minimal: generate the standard CommonJS project, or use --type bun or --type esm.",
    );
  }

  const workingDirectory = options.cwd ?? process.cwd();
  const directoryName = options.directory ?? options.name;
  const projectDirectory = join(workingDirectory, directoryName);
  const templateDirectory = fileURLToPath(
    new URL(
      `./templates/${templateDirectories[type]}/`,
      import.meta.resolve("@aponiajs/cli/package.json"),
    ),
  );
  const templateFiles = await listFiles(templateDirectory);
  const planned = planFiles(templateFiles, templateDirectory, options);
  const guideAliasFiles = planned
    .filter((file) => basename(file) === "AGENTS.md")
    .flatMap((file) => agentGuideAliases.map((alias) => join(dirname(file), alias)))
    .filter((file) => !planned.includes(file))
    .toSorted();
  const relativeFiles = [...planned, ...guideAliasFiles].toSorted();

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
      const plannedFile = plannedFileFor(templateFile, templateDirectory, options);
      if (plannedFile === undefined) {
        continue;
      }
      const outputFile = join(projectDirectory, plannedFile);
      const template = await Bun.file(templateFile).text();
      const rendered = applyOptions(plannedFile, renderTemplate(template, options.name), options);
      const output =
        options.observe === false ? stripDevtoolsDocumentation(plannedFile, rendered) : rendered;

      await mkdir(dirname(outputFile), { recursive: true });
      await Bun.write(outputFile, output);
    }

    for (const aliasFile of guideAliasFiles) {
      await symlink("AGENTS.md", join(projectDirectory, aliasFile));
    }

    if (options.skipSkills !== true) {
      await initAgent({
        cwd: projectDirectory,
        clients: options.skills ?? ["codex", "claude", "cursor"],
        skipAgents: true,
      });
    }

    if (options.skipGit !== true) {
      const git = Bun.spawn(["git", "init"], {
        cwd: projectDirectory,
        stdout: "ignore",
        stderr: "ignore",
      });
      await git.exited;
    }

    if (!options.skipInstall) {
      const packageManager = options.packageManager ?? "bun";
      const process = Bun.spawn([packageManager, "install"], {
        cwd: projectDirectory,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await process.exited;
      if (exitCode !== 0) {
        throw new Error(`${packageManager} install failed with exit code ${exitCode}.`);
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

function planFiles(
  templateFiles: readonly string[],
  templateDirectory: string,
  options: GenerateProjectOptions,
): string[] {
  return templateFiles
    .map((file) => plannedFileFor(file, templateDirectory, options))
    .filter((file): file is string => file !== undefined)
    .toSorted();
}

function plannedFileFor(
  templateFile: string,
  templateDirectory: string,
  options: GenerateProjectOptions,
): string | undefined {
  const relativeFile = outputPath(relative(templateDirectory, templateFile));
  if (basename(templateFile) === "main.minimal.ts.tmpl") {
    return options.minimal === true ? "src/main.ts" : undefined;
  }
  if (options.minimal === true) {
    return minimalFile(relativeFile);
  }
  return relativeFile;
}

function minimalFile(relativeFile: string): string | undefined {
  if (relativeFile.startsWith("src/main.")) {
    return undefined;
  }
  const allowed = new Set([
    ".env.example",
    ".gitignore",
    "aponia-cli.json",
    "package.json",
    "tsconfig.json",
  ]);
  return allowed.has(relativeFile) ? relativeFile : undefined;
}

function applyOptions(
  relativeFile: string,
  content: string,
  options: GenerateProjectOptions,
): string {
  if (relativeFile === "package.json") {
    const manifest = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      [key: string]: unknown;
    };
    if (options.minimal === true) {
      applyMinimalManifest(manifest, options.type ?? "bun");
    }
    if (options.observe === false && manifest.dependencies !== undefined) {
      delete manifest.dependencies["@aponiajs/devtools"];
    }
    return `${JSON.stringify(manifest, undefined, 2)}\n`;
  }

  if (relativeFile === "tsconfig.json" && options.strict === false) {
    const configuration = JSON.parse(content) as {
      compilerOptions?: Record<string, unknown>;
      [key: string]: unknown;
    };
    const compilerOptions = configuration.compilerOptions ?? {};
    compilerOptions.strict = false;
    configuration.compilerOptions = compilerOptions;
    return `${JSON.stringify(configuration, undefined, 2)}\n`;
  }

  if (relativeFile === "aponia-cli.json" && options.collection !== undefined) {
    const configuration = JSON.parse(content) as Record<string, unknown>;
    configuration.collection = options.collection;
    return `${JSON.stringify(configuration, undefined, 2)}\n`;
  }

  if (options.observe === false && relativeFile === "src/app.module.ts") {
    return content
      .replace(/import \{ DevtoolsModule \} from "@aponiajs\/devtools";\n/, "")
      .replace(/import \{ appLogger \} from "\.\/logger\.ts";\n/, "")
      .replace(/\n\s*imports: \[\n[\s\S]*?\n\s*\],/, "");
  }

  return content;
}

function applyMinimalManifest(
  manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    [key: string]: unknown;
  },
  type: "bun" | "esm" | "cjs",
): void {
  const scripts = manifest.scripts ?? {};
  delete scripts.build;
  delete scripts.inspect;
  const devDependencies = manifest.devDependencies ?? {};
  if (manifest.dependencies !== undefined) {
    delete manifest.dependencies["@aponiajs/devtools"];
  }

  if (type === "bun") {
    delete devDependencies["@aponiajs/cli"];
  } else {
    // The Nest-compatible minimal starter runs its one file directly, so the
    // CLI's `start` scripts and the test runner's setup go with the specs.
    scripts.start = "bun src/main.ts";
    scripts["start:dev"] = "bun --watch src/main.ts";
    scripts["start:debug"] = "bun --inspect src/main.ts";
    scripts["start:prod"] = "bun dist/main.js";
    for (const script of ["test", "test:watch", "test:cov", "test:e2e", "test:debug"]) {
      delete scripts[script];
    }
    for (const dependency of [
      "@aponiajs/cli",
      "@aponiajs/testing",
      "@types/jest",
      "@vitest/coverage-v8",
      "jest",
      "ts-jest",
      "vitest",
    ]) {
      delete devDependencies[dependency];
    }
  }

  manifest.scripts = scripts;
  manifest.devDependencies = devDependencies;
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
