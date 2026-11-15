import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LibraryCheckOptions, LibraryCheckResult } from "./check-library.types.ts";

const libraryKinds = new Set(["module", "plugin", "adapter", "utility"]);

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

async function hasDirectory(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}
