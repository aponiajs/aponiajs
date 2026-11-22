import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LibraryCheckOptions, LibraryCheckResult } from "./check-library.types.ts";

const libraryKinds = new Set(["module", "plugin", "adapter", "utility"]);
const knownPlatforms = new Set(["elysia", "hono", "h3"]);

/**
 * Packages a library may not depend on at run time: a platform and its runtime
 * belong in `peerDependencies` or `devDependencies`, because a library that
 * mounted one would stop being portable.
 */
const platformRuntimeDependencies = new Set([
  "@aponiajs/platform-elysia",
  "@aponiajs/platform-hono",
  "@aponiajs/platform-h3",
  "elysia",
  "hono",
  "h3",
]);

/**
 * Checks one generated library's package, manifest, and required files.
 *
 * The check is read-only and answers every issue it found instead of throwing.
 * `package.json` and `aponia.library.json` are the contracts; `src/index.ts`,
 * both test lanes, `README.md`, `AGENTS.md`, and `llms.txt` are the package
 * surface an agent and a consumer need.
 *
 * @param options - Working directory, library path, and publish expectation.
 * @returns The frozen result and its issue list.
 */
export async function checkLibrary(options: LibraryCheckOptions = {}): Promise<LibraryCheckResult> {
  const directory = resolve(options.cwd ?? process.cwd(), options.path ?? ".");
  const issues: string[] = [];
  const packageJson = await readJson(join(directory, "package.json"), issues, "package.json");
  const manifest = await readJson(
    join(directory, "aponia.library.json"),
    issues,
    "aponia.library.json",
  );

  if (packageJson !== undefined) {
    checkPackageJson(packageJson, options.publish === true, issues);
  }
  if (manifest !== undefined) {
    checkManifest(manifest, packageJson, issues);
    await checkRegistrationStandard(directory, manifest, issues);
    await checkSourceNeutrality(directory, manifest, issues);
  }
  const barrel = Bun.file(join(directory, "src/index.ts"));
  if (await barrel.exists()) {
    if (manifest !== undefined) {
      checkProvides(manifest, await barrel.text(), issues);
    }
  }

  for (const file of ["README.md", "AGENTS.md", "llms.txt", "src/index.ts"]) {
    if (!(await Bun.file(join(directory, file)).exists())) {
      issues.push(`missing ${file}`);
    }
  }
  for (const directoryName of ["tests", "tests-vp"]) {
    if (!(await hasDirectory(join(directory, directoryName)))) {
      issues.push(`missing ${directoryName}/`);
    }
  }

  return Object.freeze({
    ok: issues.length === 0,
    directory,
    issues: Object.freeze(issues),
  });
}

async function readJson(
  path: string,
  issues: string[],
  label: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    issues.push(`missing ${label}`);
    return undefined;
  }
  try {
    const value = (await file.json()) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push(`${label} must contain a JSON object`);
      return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    issues.push(`${label} is not valid JSON`);
    return undefined;
  }
}

function checkPackageJson(
  packageJson: Readonly<Record<string, unknown>>,
  publish: boolean,
  issues: string[],
): void {
  if (typeof packageJson.name !== "string" || packageJson.name.trim() === "") {
    issues.push("package.json name must be a non-empty string");
  }
  if (packageJson.type !== "module") {
    issues.push('package.json type must be "module"');
  }
  if (publish) {
    if (packageJson.private === true) {
      issues.push("a publishable library must not set private: true");
    }
    const publishConfig = packageJson.publishConfig;
    if (
      typeof publishConfig !== "object" ||
      publishConfig === null ||
      (publishConfig as Record<string, unknown>).access !== "public"
    ) {
      issues.push('a publishable library needs publishConfig.access "public"');
    }
  }

  const exportsField = packageJson.exports;
  if (
    typeof exportsField !== "object" ||
    exportsField === null ||
    !("." in (exportsField as Record<string, unknown>))
  ) {
    issues.push('package.json exports must declare the "." entrypoint');
  }
  const files = packageJson.files;
  if (!Array.isArray(files)) {
    issues.push("package.json files must be an array");
  } else {
    for (const required of ["dist", "llms.txt", "aponia.library.json"]) {
      if (!files.includes(required)) {
        issues.push(`package.json files must include ${required}`);
      }
    }
  }
  const scripts = packageJson.scripts;
  if (
    typeof scripts === "object" &&
    scripts !== null &&
    "postinstall" in (scripts as Record<string, unknown>)
  ) {
    issues.push("package.json must not declare a postinstall script");
  }
  const dependencies = packageJson.dependencies;
  if (typeof dependencies === "object" && dependencies !== null) {
    for (const name of Object.keys(dependencies)) {
      if (platformRuntimeDependencies.has(name)) {
        issues.push(
          `package.json must not depend on ${name} at run time; declare it as a peerDependency`,
        );
      }
    }
  }
  const peers = packageJson.peerDependencies;
  const hasCommon =
    (typeof dependencies === "object" &&
      dependencies !== null &&
      "@aponiajs/common" in dependencies) ||
    (typeof peers === "object" && peers !== null && "@aponiajs/common" in peers);
  if (!hasCommon) {
    issues.push("package.json must depend on or peer-depend on @aponiajs/common");
  }
  if (publish) {
    if (
      packageJson.version !== undefined &&
      (typeof packageJson.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version))
    ) {
      issues.push("a publishable library needs a semver version");
    }
    const keywords = packageJson.keywords;
    for (const keyword of ["aponiajs", "aponia-library"]) {
      if (!Array.isArray(keywords) || !keywords.includes(keyword)) {
        issues.push(`a publishable library needs the keyword ${keyword}`);
      }
    }
    if (typeof packageJson.license !== "string" || packageJson.license.trim() === "") {
      issues.push("a publishable library needs a license");
    }
  }
}

function checkProvides(
  manifest: Readonly<Record<string, unknown>>,
  barrel: string,
  issues: string[],
): void {
  const provides = manifest.provides;
  if (!Array.isArray(provides)) {
    return;
  }
  for (const entry of provides) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const token = (entry as Record<string, unknown>).token;
    if (typeof token !== "string" || !new RegExp(`\\b${token}\\b`).test(barrel)) {
      issues.push(
        `aponia.library.json provides ${String(token)} but src/index.ts does not export it`,
      );
    }
  }
  const requires = manifest.requires;
  if (Array.isArray(requires)) {
    for (const entry of requires) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const token = (entry as Record<string, unknown>).token;
      if (typeof token === "string" && !barrel.includes(token)) {
        issues.push(`aponia.library.json requires ${token} but src/index.ts does not import it`);
      }
    }
  }
}

function checkManifest(
  manifest: Readonly<Record<string, unknown>>,
  packageJson: Readonly<Record<string, unknown>> | undefined,
  issues: string[],
): void {
  if (manifest.contractVersion !== 1) {
    issues.push("aponia.library.json contractVersion must be 1");
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    issues.push("aponia.library.json name must be a non-empty string");
  } else if (packageJson !== undefined && packageJson.name !== manifest.name) {
    issues.push("aponia.library.json name must match package.json name");
  }
  if (typeof manifest.kind !== "string" || !libraryKinds.has(manifest.kind)) {
    issues.push('aponia.library.json kind must be "module", "plugin", "adapter", or "utility"');
  }
  const platforms = manifest.platforms;
  if (platforms !== undefined) {
    if (!Array.isArray(platforms) || platforms.length === 0) {
      issues.push("aponia.library.json platforms must be a non-empty array when stated");
    } else {
      for (const platform of platforms) {
        if (typeof platform !== "string" || !knownPlatforms.has(platform)) {
          issues.push(
            `aponia.library.json platforms names an unknown platform: ${String(platform)}`,
          );
        }
      }
    }
  }
  const framework = manifest.framework;
  if (
    typeof framework !== "object" ||
    framework === null ||
    typeof (framework as Record<string, unknown>).aponia !== "string"
  ) {
    issues.push("aponia.library.json framework.aponia must be a string");
  }
  const entrypoints = manifest.entrypoints;
  if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
    issues.push("aponia.library.json entrypoints must be a non-empty array");
  } else if (
    !entrypoints.some(
      (entrypoint) =>
        typeof entrypoint === "object" &&
        entrypoint !== null &&
        (entrypoint as Record<string, unknown>).subpath === ".",
    )
  ) {
    issues.push('aponia.library.json entrypoints must declare subpath "."');
  }
  const provides = manifest.provides;
  if (!Array.isArray(provides) || provides.length === 0) {
    issues.push("aponia.library.json provides must be a non-empty array");
  }
  const security = manifest.security;
  if (
    typeof security === "object" &&
    security !== null &&
    (security as Record<string, unknown>).postinstall === true
  ) {
    issues.push("aponia.library.json security.postinstall must not be true");
  }
}

/**
 * Requires the Nest-style registration surface on a module or plugin library.
 *
 * @param directory - The package root.
 * @param manifest - The library contract.
 * @param issues - The issue list the check fills.
 */
async function checkRegistrationStandard(
  directory: string,
  manifest: Readonly<Record<string, unknown>>,
  issues: string[],
): Promise<void> {
  if (manifest.kind !== "module" && manifest.kind !== "plugin") {
    return;
  }
  let source = "";
  for await (const path of new Bun.Glob("src/**/*.ts").scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    source += await Bun.file(join(directory, path)).text();
  }
  for (const member of ["forRoot(", "forRootAsync("]) {
    if (!source.includes(member)) {
      issues.push(
        `a ${String(manifest.kind)} library must declare static ${member.slice(0, -1)}(...) returning a DynamicModule`,
      );
    }
  }
}

/**
 * Refuses a platform or runtime import in a library's own source.
 *
 * A native mount belongs in an `adapter` library, which states the platform in
 * `platforms` and is allowed to import it; every other kind stays neutral.
 *
 * @param directory - The package root.
 * @param manifest - The library contract.
 * @param issues - The issue list the check fills.
 */
async function checkSourceNeutrality(
  directory: string,
  manifest: Readonly<Record<string, unknown>>,
  issues: string[],
): Promise<void> {
  if (manifest.kind === "adapter") {
    return;
  }
  const runtimeImport =
    /from\s+["'](?:elysia|hono|h3|nitro|@aponiajs\/platform-(?:elysia|hono|h3))(?:["'/])/;
  for await (const path of new Bun.Glob("src/**/*.ts").scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    if (path.startsWith("src/adapters/")) {
      continue;
    }
    const source = await Bun.file(join(directory, path)).text();
    if (runtimeImport.test(source)) {
      issues.push(`${path} imports a platform at run time; keep the library runtime-neutral`);
    }
  }
}

async function hasDirectory(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}
