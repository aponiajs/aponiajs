import { lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { aponiaVersion } from "../version.ts";
import { agentGuideAliases } from "./file-writer.ts";
import { initAgent } from "../agent/init-agent.ts";
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
  const platform = options.platform ?? "elysia";
  const workspace = options.workspace === true;
  const appPrefix = workspace ? "apps/api" : "";
  const baseFiles = [
    ...templateFiles.map((file) =>
      workspace
        ? join(appPrefix, outputPath(relative(templateDirectory, file)))
        : outputPath(relative(templateDirectory, file)),
    ),
    ...(workspace ? Object.keys(workspaceRootFiles(options.name, platform)) : []),
  ].toSorted();
  const guideAliasFiles = baseFiles
    .filter((file) => basename(file) === "AGENTS.md")
    .flatMap((file) => agentGuideAliases.map((alias) => join(dirname(file), alias)))
    .filter((file) => !baseFiles.includes(file))
    .toSorted();
  const relativeFiles = [...baseFiles, ...guideAliasFiles].toSorted();

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
      const output = applyPlatform(
        relativeFile,
        renderTemplate(template, workspace ? "api" : options.name),
        platform,
      );

      await mkdir(dirname(outputFile), { recursive: true });
      await Bun.write(outputFile, output);
    }

    if (workspace) {
      for (const [relativeFile, content] of Object.entries(
        workspaceRootFiles(options.name, platform),
      )) {
        const outputFile = join(projectDirectory, relativeFile);
        await mkdir(dirname(outputFile), { recursive: true });
        await Bun.write(outputFile, content);
      }
    }

    if (workspace) {
      const appTsconfigPath = join(projectDirectory, "apps/api/tsconfig.json");
      const appTsconfig = await Bun.file(appTsconfigPath).text();
      await Bun.write(
        appTsconfigPath,
        appTsconfig.replace(/^\{/, `{\n  "extends": "../../tsconfig.json",`),
      );
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

function workspaceRootFiles(
  projectName: string,
  platform: "elysia" | "hono" | "h3" = "elysia",
): Readonly<Record<string, string>> {
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
        defaultLibraryPrefix: "@app",
        platform,
        projects: {
          api: {
            type: "application",
            root: "apps/api",
            entryFile: "main",
            sourceRoot: "apps/api/src",
            compilerOptions: { tsConfigPath: "apps/api/tsconfig.json" },
          },
        },
        generateOptions: { spec: true },
      },
      undefined,
      2,
    )}\n`,
    "README.md": `# ${projectName}\n\nAn AponiaJS workspace. Applications live under \`apps/\` and shared libraries under \`libs/\`.\n`,
    "AGENTS.md": `# ${projectName}\n\n\`CLAUDE.md\` and \`GEMINI.md\` are symlinks to this file.\n\nRead the [AponiaJS repository guide](https://github.com/aponiajs/aponiajs/blob/release/alpha/AGENTS.md).\nProduct code lives in \`apps/\`; reusable modules live in \`libs/\`.\n`,
    ".gitignore": "node_modules\ndist\n.env\n*.log\n",
    "tsconfig.json":
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            lib: ["ESNext"],
            module: "Preserve",
            moduleResolution: "Bundler",
            moduleDetection: "force",
            types: ["bun"],
            strict: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            noUnusedLocals: true,
            noEmit: true,
            allowImportingTsExtensions: true,
            isolatedModules: true,
            verbatimModuleSyntax: true,
            skipLibCheck: true,
          },
          paths: {},
        },
        undefined,
        2,
      ) + "\n",
    "libs/.gitkeep": "",
  };
}

function applyPlatform(
  relativeFile: string,
  content: string,
  platform: "elysia" | "hono" | "h3",
): string {
  const packageName =
    platform === "elysia"
      ? "@aponiajs/platform-elysia"
      : platform === "hono"
        ? "@aponiajs/platform-hono"
        : "@aponiajs/platform-h3";

  if (relativeFile.endsWith("package.json")) {
    if (platform === "elysia") {
      return content;
    }
    const manifest = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      [key: string]: unknown;
    };
    const dependencies = manifest.dependencies ?? {};
    delete dependencies["@aponiajs/platform-elysia"];
    delete dependencies["@aponiajs/devtools"];
    delete dependencies.elysia;
    delete dependencies.hono;
    delete dependencies.h3;
    dependencies[packageName] = aponiaVersion;
    if (platform === "hono") {
      dependencies.hono = "^4.13.17";
    } else {
      dependencies.h3 = "^2.0.8";
    }
    manifest.dependencies = Object.fromEntries(
      Object.entries(dependencies).toSorted(([left], [right]) => left.localeCompare(right)),
    );
    return `${JSON.stringify(manifest, undefined, 2)}\n`;
  }

  if (relativeFile.endsWith("main.ts") || relativeFile.endsWith("app.e2e-spec.ts")) {
    let rendered = content.replaceAll("@aponiajs/platform-elysia", packageName);
    if (platform !== "elysia") {
      rendered = rendered
        .replace(/import \{ devtoolsPlugin \} from "@aponiajs\/devtools";\n/, "")
        .replace(/\n\s*plugins: \[\n[\s\S]*?\n\s*\],/, "");
    }
    return rendered;
  }

  if (relativeFile.endsWith("bunfig.toml") && platform !== "elysia") {
    return "";
  }

  if (relativeFile.endsWith("aponia.json")) {
    const configuration = JSON.parse(content) as Record<string, unknown>;
    configuration.platform = platform;
    configuration.type = "application";
    configuration.entryFile ??= "main";
    return `${JSON.stringify(configuration, undefined, 2)}\n`;
  }

  return content;
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
