import { resolve } from "node:path";

/**
 * Known files that reference the pinned Elysia version across manifests,
 * templates, documentation, and tests.
 */
export const elysiaTargetFiles = [
  "package.json",
  "packages/platform-elysia/package.json",
  "packages/cors/package.json",
  "packages/cron/package.json",
  "packages/devtools/package.json",
  "packages/graphql/package.json",
  "packages/mcp/package.json",
  "packages/openapi/package.json",
  "packages/opentelemetry/package.json",
  "packages/testing/package.json",
  "packages/cli/templates/application/package.json",
  "examples/basic/package.json",
  "examples/configuration/package.json",
  "examples/dependency-injection/package.json",
  "examples/descriptors/package.json",
  "examples/devtools/package.json",
  "examples/eden-treaty/package.json",
  "examples/files/package.json",
  "examples/lifecycle/package.json",
  "examples/multiple-routers/package.json",
  "examples/native-plugins/package.json",
  "examples/request-parameters/package.json",
  "examples/validation/package.json",
  "examples/websockets/package.json",
  "packages/cli/templates/application/src/descriptors.generated.ts.tmpl",
  "packages/cli/templates/application/src/invokers.generated.ts.tmpl",
  "docs/elysia-compatibility.md",
  "docs/devtools.md",
  "docs/packages.md",
  "docs/files.md",
  "docs/eden-treaty.md",
  "docs/learn/02-install-and-generate.md",
  "packages/platform-elysia/README.md",
  "packages/platform-elysia/AGENTS.md",
  "packages/cors/tests/generated-descriptors.test.ts",
  "packages/graphql/tests/generated-descriptors.test.ts",
  "packages/openapi/tests/generated-descriptors.test.ts",
  "packages/opentelemetry/tests/opentelemetry-module.test.ts",
  "scripts/documentation-versions.spec.ts",
  "examples/files/test/uploads.e2e-spec.ts",
] as const;

export interface UpdateElysiaVersionOptions {
  readonly currentVersion?: string;
  readonly edenVersion?: string;
  readonly log?: (message: string) => void;
  readonly runInstall?: boolean;
  readonly spawnSync?: (
    args: readonly string[],
    options: { readonly cwd: string },
  ) => { readonly exitCode: number };
  readonly targetVersion: string;
  readonly workspaceRoot?: string;
}

export interface UpdateElysiaVersionResult {
  readonly currentVersion: string;
  readonly edenUpdated: boolean;
  readonly targetVersion: string;
  readonly updatedFiles: readonly string[];
}

/**
 * Resolves the currently pinned Elysia version from the platform package manifest.
 */
export async function resolveCurrentElysiaVersion(workspaceRoot: string): Promise<string> {
  const manifestPath = resolve(workspaceRoot, "packages/platform-elysia/package.json");
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    throw new Error(`Cannot find platform manifest at ${manifestPath}.`);
  }

  const manifest = (await file.json()) as {
    readonly peerDependencies?: { readonly elysia?: unknown };
  };

  const version = manifest.peerDependencies?.elysia;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Platform manifest does not declare a peerDependency for elysia.`);
  }

  return version;
}

/**
 * Resolves the currently pinned @elysia/eden version from the platform package manifest.
 */
export async function resolveCurrentEdenVersion(
  workspaceRoot: string,
): Promise<string | undefined> {
  const manifestPath = resolve(workspaceRoot, "packages/platform-elysia/package.json");
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    return undefined;
  }

  const manifest = (await file.json()) as {
    readonly devDependencies?: { readonly ["@elysia/eden"]?: unknown };
  };

  const version = manifest.devDependencies?.["@elysia/eden"];
  return typeof version === "string" ? version : undefined;
}

/**
 * Default spawn runner using Bun.spawnSync.
 */
export function defaultSpawnRunner(
  args: readonly string[],
  options: { readonly cwd: string },
): { readonly exitCode: number } {
  return Bun.spawnSync(args as string[], {
    cwd: options.cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
}

/**
 * Queries npm dist-tags for the latest Elysia version matching the channel
 * of the currently installed version (prerelease on "next", stable on "latest").
 */
export async function fetchLatestNpmDistTag(
  packageName: string,
  preferNext = false,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const url = `https://registry.npmjs.org/${packageName}`;
  const response = await fetcher(url, {
    headers: { Accept: "application/vnd.npm.install-v1+json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${packageName} from npm: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    readonly "dist-tags"?: Readonly<Record<string, string>>;
  };

  const distTags = data["dist-tags"];
  if (!distTags) {
    throw new Error(`No dist-tags found for ${packageName}.`);
  }

  if (preferNext && typeof distTags.next === "string") {
    return distTags.next;
  }

  if (typeof distTags.latest === "string") {
    return distTags.latest;
  }

  throw new Error(`Could not resolve tag for ${packageName}.`);
}

/**
 * Collects target files including any dynamic example package manifests.
 */
export async function collectTargetFiles(workspaceRoot: string): Promise<readonly string[]> {
  const files = new Set<string>(elysiaTargetFiles);
  const glob = new Bun.Glob("examples/*/package.json");

  for await (const match of glob.scan({ cwd: workspaceRoot, onlyFiles: true })) {
    files.add(match);
  }

  return Object.freeze([...files].toSorted());
}

/**
 * Synchronizes the pinned Elysia version across manifests, templates, docs, and tests.
 */
export async function updateElysiaVersion(
  options: UpdateElysiaVersionOptions,
): Promise<UpdateElysiaVersionResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const log = options.log ?? console.log;

  const currentVersion =
    options.currentVersion ?? (await resolveCurrentElysiaVersion(workspaceRoot));
  const targetVersion = options.targetVersion;

  if (currentVersion === targetVersion && !options.edenVersion) {
    log(`Elysia is already at ${targetVersion}. No files updated.`);
    return {
      currentVersion,
      targetVersion,
      edenUpdated: false,
      updatedFiles: Object.freeze([]),
    };
  }

  const currentEdenVersion = await resolveCurrentEdenVersion(workspaceRoot);
  const targetEdenVersion = options.edenVersion;

  const files = await collectTargetFiles(workspaceRoot);
  const updatedFiles: string[] = [];

  for (const relativePath of files) {
    const fullPath = resolve(workspaceRoot, relativePath);
    const bunFile = Bun.file(fullPath);

    if (!(await bunFile.exists())) {
      continue;
    }

    const content = await bunFile.text();
    let updatedContent = content;

    if (currentVersion !== targetVersion && updatedContent.includes(currentVersion)) {
      updatedContent = updatedContent.replaceAll(currentVersion, targetVersion);
    }

    if (
      targetEdenVersion &&
      currentEdenVersion &&
      currentEdenVersion !== targetEdenVersion &&
      updatedContent.includes(currentEdenVersion)
    ) {
      updatedContent = updatedContent.replaceAll(currentEdenVersion, targetEdenVersion);
    }

    if (updatedContent !== content) {
      await Bun.write(fullPath, updatedContent);
      updatedFiles.push(relativePath);
    }
  }

  log(
    `Updated Elysia from ${currentVersion} to ${targetVersion} across ${updatedFiles.length} files.`,
  );

  if (options.runInstall) {
    log("Refreshing lockfile with bun install...");
    const spawnRunner = options.spawnSync ?? defaultSpawnRunner;

    const installResult = spawnRunner(["bun", "install"], {
      cwd: workspaceRoot,
    });

    if (installResult.exitCode !== 0) {
      throw new Error(`bun install failed with exit code ${installResult.exitCode}.`);
    }

    const syncScript = resolve(workspaceRoot, "scripts/sync-version-references.ts");
    if (await Bun.file(syncScript).exists()) {
      spawnRunner(["bun", syncScript], {
        cwd: workspaceRoot,
      });
    }
  }

  return {
    currentVersion,
    targetVersion,
    edenUpdated: Boolean(targetEdenVersion && currentEdenVersion !== targetEdenVersion),
    updatedFiles: Object.freeze(updatedFiles),
  };
}

export interface UpdateEntryOptions {
  readonly args?: readonly string[];
  readonly log?: (message: string) => void;
  readonly workspaceRoot?: string;
}

/**
 * Entry function called when running the script directly via CLI.
 */
export async function updateElysiaVersionEntry(
  options: UpdateEntryOptions = {},
): Promise<UpdateElysiaVersionResult> {
  const args = options.args ?? process.argv.slice(2);
  const workspaceRoot = options.workspaceRoot ?? resolve(import.meta.dir, "..");
  const log = options.log ?? console.log;

  if (args.includes("--help") || args.includes("-h")) {
    log(
      "Usage: bun scripts/update-elysia-version.ts [targetVersion] [--eden <version>] [--no-install]",
    );
    return {
      currentVersion: "",
      targetVersion: "",
      edenUpdated: false,
      updatedFiles: Object.freeze([]),
    };
  }

  const noInstall = args.includes("--no-install");
  const edenIndex = args.indexOf("--eden");
  const edenVersion = edenIndex !== -1 && args[edenIndex + 1] ? args[edenIndex + 1] : undefined;

  const positionalArg = args.find((arg) => !arg.startsWith("-") && arg !== edenVersion);

  const currentVersion = await resolveCurrentElysiaVersion(workspaceRoot);
  let targetVersion = positionalArg;

  if (!targetVersion) {
    const isPrerelease = currentVersion.includes("-");
    log(`Querying npm for the latest Elysia version (${isPrerelease ? "next" : "latest"})...`);
    targetVersion = await fetchLatestNpmDistTag("elysia", isPrerelease);
  }

  return updateElysiaVersion({
    workspaceRoot,
    currentVersion,
    targetVersion,
    edenVersion,
    runInstall: !noInstall,
    log,
  });
}

if (import.meta.main) {
  await updateElysiaVersionEntry();
}
