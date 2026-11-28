/**
 * One-shot layout codemod for the Nest 1:1 path migration.
 *
 * The codemod derives a deterministic per-file mapping from the naming contract
 * in the rewrite plan, then moves files, rewrites relative imports, and rewrites
 * repository-relative path references in JSDoc and Markdown. It refuses to guess
 * at a file that exports more than one Nest kind and reports every collision
 * instead of overwriting a target.
 *
 * Run it dry first, then apply:
 *
 * ```sh
 * bun run scripts/nest-layout-codemod.ts
 * bun run scripts/nest-layout-codemod.ts --apply --write-map
 * ```
 */
import { mkdir, readdir, rename, rmdir, stat } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";

export const layoutMapPath = "scripts/nest-layout.map.json";

export type MoveCategory = "source" | "test" | "conformance" | "e2e" | "helper";

export interface LayoutMove {
  readonly from: string;
  readonly to: string;
  readonly category: MoveCategory;
}

export interface LayoutCollision {
  readonly to: string;
  readonly from: readonly string[];
}

export interface LayoutPlan {
  readonly moves: readonly LayoutMove[];
  readonly directoryMoves: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  readonly collisions: readonly LayoutCollision[];
  readonly multiKindFiles: readonly string[];
  readonly unmappedFiles: readonly string[];
  readonly typeOnlyExceptions: readonly string[];
}

export interface LayoutReport {
  readonly movedCount: number;
  readonly splitCount: number;
  readonly collisions: readonly LayoutCollision[];
  readonly multiKindFiles: readonly string[];
  readonly unmappedFiles: readonly string[];
  readonly unmovedImports: readonly string[];
  readonly unresolvedLinks: readonly string[];
}

const classKinds: readonly string[] = [
  "controller",
  "controllers",
  "interceptor",
  "interceptors",
  "repository",
  "repositories",
  "middleware",
  "strategy",
  "decorator",
  "decorators",
  "explorer",
  "provider",
  "providers",
  "accessor",
  "service",
  "services",
  "gateway",
  "gateways",
  "filter",
  "filters",
  "module",
  "modules",
  "guard",
  "guards",
  "entity",
  "pipe",
  "pipes",
  "dto",
];

const descriptiveKinds: readonly string[] = [
  "constants",
  "exception",
  "exceptions",
  "factories",
  "factory",
  "handlers",
  "handler",
  "policies",
  "policy",
  "registries",
  "registry",
  "resolvers",
  "resolver",
  "builder",
  "builders",
  "stores",
  "store",
];

const pluralSingular: Readonly<Record<string, string>> = {
  builders: "builder",
  constants: "constants",
  controllers: "controller",
  decorators: "decorator",
  entities: "entity",
  exceptions: "exception",
  explorers: "explorer",
  factories: "factory",
  filters: "filter",
  gateways: "gateway",
  guards: "guard",
  handlers: "handler",
  interceptors: "interceptor",
  middlewares: "middleware",
  modules: "module",
  pipes: "pipe",
  policies: "policy",
  providers: "providers",
  registries: "registry",
  repositories: "repository",
  resolvers: "resolver",
  services: "service",
  stores: "store",
  strategies: "strategy",
};

function singular(suffix: string): string {
  return pluralSingular[suffix] ?? suffix;
}

const suffixKinds: ReadonlyMap<string, string> = new Map(
  [...classKinds, ...descriptiveKinds]
    .map((suffix): readonly [string, string] => [suffix, singular(suffix)])
    .toSorted((left, right) => right[0].length - left[0].length),
);

/** Directories whose contract requires flat `*.interface.ts` files beside sources. */
const flatInterfacePackages = new Set(["rate-limit"]);

/** Type-only files the Nest counterpart keeps as `*.types.ts`. */
const typeOnlyExceptions = new Set([
  "packages/metrics/src/runtime/metrics-plugin.types.ts",
  "packages/platform-core/src/plugins/plugin-builder.types.ts",
  "packages/platform-core/src/plugins/platform-module.types.ts",
  "packages/platform-elysia/src/plugins/plugin-builder.types.ts",
  "packages/platform-elysia/src/plugins/plugin.types.ts",
  "packages/schematics/src/lib/schematic.types.ts",
]);

/** Directory rewrites per package, applied to a relative directory path. */
const directoryRules: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  common: [
    ["logging", "services"],
    ["errors", "exceptions"],
  ],
  core: [
    ["graph", "scanner"],
    ["container", "injector"],
  ],
  "platform-core": [
    ["errors", "exceptions"],
    ["plugins", "platform"],
  ],
  "platform-elysia": [["errors", "exceptions"]],
  cache: [
    ["module", ""],
    ["service", ""],
    ["store", ""],
  ],
  cron: [["module", ""]],
  events: [
    ["module", ""],
    ["emitter", ""],
    ["listener", ""],
  ],
  http: [
    ["module", ""],
    ["client", ""],
  ],
  auth: [
    ["authentication", ""],
    ["authorization", ""],
    ["jwt", ""],
    ["module", ""],
    ["oidc", ""],
    ["refresh", ""],
    ["revocation", ""],
  ],
  tenancy: [
    ["module", ""],
    ["service", ""],
    ["guard", ""],
  ],
  metrics: [
    ["module", ""],
    ["runtime", ""],
  ],
  openapi: [["module", ""]],
  graphql: [["module", ""]],
  database: [
    ["module", ""],
    ["database", ""],
  ],
  queue: [["module", ""]],
};

const directoryMoveList: ReadonlyArray<{ readonly from: string; readonly to: string }> =
  Object.entries(directoryRules)
    .flatMap(([packageName, rules]) =>
      rules.map(([from, to]) => ({
        from: `packages/${packageName}/src/${from}`,
        to: to.length === 0 ? `packages/${packageName}/src` : `packages/${packageName}/src/${to}`,
      })),
    )
    .toSorted((left, right) => right.from.length - left.from.length);

/** Per-file targets a naming rule cannot derive. */
const fileOverrides: Readonly<Record<string, string>> = {
  "packages/common/src/decorators/apply-decorators.ts":
    "packages/common/src/decorators/apply-decorators.ts",
  "packages/common/src/errors/aponia-error.types.ts":
    "packages/common/src/exceptions/aponia-error.interface.ts",
  "packages/common/src/logging/console-logger.ts":
    "packages/common/src/services/console-logger.service.ts",
  "packages/common/src/logging/logger-observer.ts":
    "packages/common/src/services/logger-observer.service.ts",
  "packages/common/src/logging/log-value.ts": "packages/common/src/services/log-value.ts",
  "packages/common/src/logging/logger-token.ts": "packages/common/src/services/logger-token.ts",
  "packages/common/src/modules/configurable-module.ts":
    "packages/common/src/module-utils/configurable-module.builder.ts",
  "packages/common/src/modules/module-async-options.ts":
    "packages/common/src/module-utils/module-async-options.ts",
  "packages/cache/src/module/cache-module.constants.ts": "packages/cache/src/cache.constants.ts",
  "packages/cron/src/schedule.constants.ts": "packages/cron/src/cron.constants.ts",
  "packages/events/src/module/event-emitter-module.ts": "packages/events/src/events.module.ts",
  "packages/events/src/listener/on-event.ts":
    "packages/events/src/decorators/on-event.decorator.ts",
  "packages/http/src/module/http-module.constants.ts": "packages/http/src/http-client.constants.ts",
  "packages/http/src/module/http-options.ts": "packages/http/src/http-client.providers.ts",
  "packages/http/src/client/http-service.ts": "packages/http/src/http-client.service.ts",
  "packages/auth/src/password/password.service.ts":
    "packages/auth/src/password/password-hasher.service.ts",
  "packages/metrics/src/module/metrics-module.constants.ts":
    "packages/metrics/src/metrics.constants.ts",
  "packages/metrics/src/runtime/metrics-exception.filter.ts":
    "packages/metrics/src/metrics.filter.ts",
  "packages/platform-core/src/plugins/platform-module.ts":
    "packages/platform-core/src/platform/platform-module.ts",
  "packages/platform-elysia/src/request-context/request-context-module.ts":
    "packages/platform-elysia/src/request-context/request-context-module.ts",
  "packages/testing/src/application/testing-module.ts": "packages/testing/src/application/test.ts",
  "packages/tenancy/src/service/tenant.constants.ts": "packages/tenancy/src/tenant.constants.ts",
  "packages/platform-elysia/src/application/elysia-adapter.ts":
    "packages/platform-elysia/src/adapters/elysia-adapter.ts",
};

/** Rewrites one file name to the Nest kind suffix the naming contract requires. */
export function transformFileName(name: string): string {
  if (name === "index.ts" || !name.endsWith(".ts")) {
    return name;
  }
  const stem = name.slice(0, -".ts".length);
  if (stem.endsWith(".module-definition") || stem.endsWith(".constants")) {
    return name;
  }
  for (const [suffix, kind] of suffixKinds) {
    const marker = `-${suffix}`;
    if (stem.endsWith(marker)) {
      const base = stem.slice(0, -marker.length);
      if (base.length === 0) {
        return name;
      }
      return `${base}.${kind}.ts`;
    }
  }
  return name;
}

function joinDirectory(directory: string, name: string): string {
  return directory.length === 0 ? name : `${directory}/${name}`;
}

/** Computes the target of a `packages/<pkg>/src/...` file. */
export function computeSourceTarget(
  packageName: string,
  relativePath: string,
  overrides: Readonly<Record<string, string>> = fileOverrides,
): string {
  const absolute = `packages/${packageName}/src/${relativePath}`;
  const override = overrides[absolute];
  if (override !== undefined) {
    return override;
  }

  const segments = relativePath.split("/");
  const name = segments.pop() ?? relativePath;
  let directory = segments.join("/");

  for (const [from, to] of directoryRules[packageName] ?? []) {
    if (directory === from) {
      directory = to;
      break;
    }
    if (directory.startsWith(`${from}/`)) {
      directory = `${to}${directory.slice(from.length)}`.replace(/^\//, "");
      break;
    }
  }

  if (name.endsWith(".types.ts") && !typeOnlyExceptions.has(absolute)) {
    const base = name.slice(0, -".types.ts".length);
    const targetDirectory = flatInterfacePackages.has(packageName) ? directory : "interfaces";
    return `packages/${packageName}/src/${joinDirectory(targetDirectory, `${base}.interface.ts`)}`;
  }

  return `packages/${packageName}/src/${joinDirectory(directory, transformFileName(name))}`;
}

function slug(name: string): string {
  const stem = name.endsWith(".ts") ? name.slice(0, -".ts".length) : name;
  const parts = stem.split(/[.-]/).filter((part) => part.length > 0);
  const meaningful = parts.filter((part) => ![...classKinds, ...descriptiveKinds].includes(part));
  return (meaningful.length > 0 ? meaningful : parts).join("-");
}

interface SourceIndexEntry {
  readonly slug: string;
  readonly directory: string;
}

function buildSourceIndex(
  packageName: string,
  files: readonly string[],
  targetOf: (relativePath: string) => string,
): readonly SourceIndexEntry[] {
  const prefix = `packages/${packageName}/src/`;
  return files
    .map((relativePath): SourceIndexEntry => {
      const rest = targetOf(relativePath).slice(prefix.length);
      return {
        slug: slug(rest.split("/").pop() ?? rest),
        directory: dirname(rest) === "." ? "" : dirname(rest),
      };
    })
    .filter((entry) => entry.slug.length > 0);
}

/** Chooses the source directory a colocated spec belongs beside. */
export function chooseSpecDirectory(slugValue: string, index: readonly SourceIndexEntry[]): string {
  const candidates = index.filter(
    (entry) =>
      !(entry.directory === "interfaces" || entry.directory.endsWith("/interfaces")) &&
      (entry.slug.length >= 3 || entry.slug === slugValue),
  );
  const byDirectory = (left: SourceIndexEntry, right: SourceIndexEntry): number =>
    left.directory.length - right.directory.length || left.directory.localeCompare(right.directory);
  const exact = candidates.filter((entry) => entry.slug === slugValue).toSorted(byDirectory);
  if (exact[0] !== undefined) {
    return exact[0].directory;
  }
  const moreSpecific = candidates
    .filter(
      (entry) => slugValue.startsWith(`${entry.slug}-`) || slugValue.startsWith(`${entry.slug}.`),
    )
    .toSorted((left, right) => right.slug.length - left.slug.length || byDirectory(left, right));
  const chosen = moreSpecific[0];
  if (chosen !== undefined) {
    return chosen.directory;
  }
  const broader = candidates
    .filter(
      (entry) => entry.slug.startsWith(`${slugValue}-`) || entry.slug.startsWith(`${slugValue}.`),
    )
    .toSorted((left, right) => left.slug.length - right.slug.length || byDirectory(left, right));
  if (broader[0] !== undefined) {
    return broader[0].directory;
  }
  const directories = new Set(
    index.map((entry) => entry.directory).filter((directory) => directory.length > 0),
  );
  return directories.has(slugValue) ? slugValue : "";
}

/** Computes the target of a file under `tests/`, `tests-vp/`, or `e2e/`. */
export function computeTestTarget(
  packageName: string,
  relativePath: string,
  sourceIndex: readonly SourceIndexEntry[],
  hasSourceRoot = true,
): { readonly target: string; readonly category: MoveCategory } {
  if (relativePath.startsWith("tests-vp/")) {
    return {
      target: `packages/${packageName}/test/${relativePath.slice("tests-vp/".length)}`,
      category: "conformance",
    };
  }
  if (relativePath.startsWith("e2e/")) {
    const name = relativePath.slice("e2e/".length).replace(/\.e2e\.ts$/, ".e2e-spec.ts");
    return { target: `packages/${packageName}/test/${name}`, category: "e2e" };
  }

  const rest = relativePath.slice("tests/".length);
  if (rest.endsWith(".e2e-spec.ts") || rest.includes("/") || !rest.endsWith(".test.ts")) {
    return { target: `packages/${packageName}/test/${rest}`, category: "e2e" };
  }

  const name = rest.slice(0, -".test.ts".length);
  if (!hasSourceRoot) {
    return { target: `packages/${packageName}/test/${name}.spec.ts`, category: "test" };
  }
  const directory = chooseSpecDirectory(slug(name), sourceIndex);
  return {
    target: `packages/${packageName}/src/${joinDirectory(directory, `${name}.spec.ts`)}`,
    category: "test",
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Lists every TypeScript file under one repository-relative directory. */
async function walk(root: string, directory: string): Promise<readonly string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await walk(root, relativePath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }
  return files;
}

async function safeWalk(root: string, directory: string): Promise<readonly string[]> {
  if (!(await pathExists(join(root, directory)))) {
    return [];
  }
  return walk(root, directory);
}

async function isMultiKind(root: string, path: string): Promise<boolean> {
  // A spec writes generated source as its own fixture text; it is never split.
  if (path.endsWith(".spec.ts")) {
    return false;
  }
  const source = await Bun.file(join(root, path)).text();
  const kinds = new Set<string>();
  for (const match of source.matchAll(/^export (?:abstract )?class (\w+)/gm)) {
    const name = match[1] ?? "";
    for (const kind of classKinds) {
      const suffix = `${singular(kind).charAt(0).toUpperCase()}${singular(kind).slice(1)}`;
      if (name.endsWith(suffix)) {
        kinds.add(singular(kind));
        break;
      }
    }
  }
  return kinds.size > 1;
}

/** Builds the deterministic layout plan for a workspace root. */
export async function planLayout(root: string): Promise<LayoutPlan> {
  const packages = (await readdir(join(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  const moves: LayoutMove[] = [];
  const unmappedFiles: string[] = [];
  const multiKindFiles: string[] = [];

  for (const packageName of packages) {
    const hasSourceRoot = await pathExists(join(root, `packages/${packageName}/src`));
    const sourceFiles = await safeWalk(root, `packages/${packageName}/src`);
    const targetOf = (relativePath: string): string =>
      computeSourceTarget(packageName, relativePath);
    const sourcePrefix = `packages/${packageName}/src/`;
    for (const from of sourceFiles) {
      const relativePath = from.slice(sourcePrefix.length);
      const to = targetOf(relativePath);
      if (await isMultiKind(root, from)) {
        multiKindFiles.push(from);
        continue;
      }
      if (to === from) {
        continue;
      }
      moves.push({ from, to, category: "source" });
    }

    const sourceIndex = buildSourceIndex(
      packageName,
      sourceFiles.map((file) => file.slice(sourcePrefix.length)),
      targetOf,
    );
    for (const area of ["tests", "tests-vp", "e2e"]) {
      const prefix = `packages/${packageName}/${area}/`;
      for (const from of await safeWalk(root, `packages/${packageName}/${area}`)) {
        const relativePath = from.slice(prefix.length);
        const { target, category } = computeTestTarget(
          packageName,
          `${area}/${relativePath}`,
          sourceIndex,
          hasSourceRoot,
        );
        if (target === from) {
          continue;
        }
        moves.push({ from, to: target, category });
      }
    }
  }

  const grouped = new Map<string, string[]>();
  for (const move of moves) {
    grouped.set(move.to, [...(grouped.get(move.to) ?? []), move.from]);
  }
  const vacated = new Set(moves.map((move) => move.from));
  for (const move of moves) {
    if (vacated.has(move.to)) {
      continue;
    }
    if (await pathExists(join(root, move.to))) {
      grouped.set(move.to, [...(grouped.get(move.to) ?? []), `${move.to} (already on disk)`]);
    }
  }
  const collisions: LayoutCollision[] = [...grouped]
    .filter(([, sources]) => sources.length > 1)
    .map(([to, sources]) => ({ to, from: Object.freeze(sources.toSorted()) }));

  return Object.freeze({
    moves: Object.freeze(moves.toSorted((left, right) => left.from.localeCompare(right.from))),
    directoryMoves: Object.freeze(directoryMoveList),
    collisions: Object.freeze(collisions),
    multiKindFiles: Object.freeze(multiKindFiles.toSorted()),
    unmappedFiles: Object.freeze(unmappedFiles.toSorted()),
    typeOnlyExceptions: Object.freeze([...typeOnlyExceptions].toSorted()),
  });
}

/** Serializes a plan into the committed map file. */
export function renderLayoutPlan(plan: LayoutPlan): string {
  return `${JSON.stringify(
    {
      version: 1,
      moves: plan.moves.map((move) => ({ from: move.from, to: move.to, category: move.category })),
      directoryMoves: plan.directoryMoves,
      typeOnlyExceptions: plan.typeOnlyExceptions,
    },
    null,
    2,
  )}\n`;
}

function pathRewriteTable(plan: LayoutPlan): ReadonlyArray<readonly [string, string]> {
  const rewrites: Array<readonly [string, string]> = plan.moves.map((move) => [move.from, move.to]);
  for (const directory of plan.directoryMoves) {
    rewrites.push([directory.from, directory.to]);
  }
  return rewrites.toSorted((left, right) => right[0].length - left[0].length);
}

const specifierPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\1/g;
const repositoryPathPattern =
  /(?:\.\.\/)*packages\/[A-Za-z0-9_.-]+\/(?:src|tests|tests-vp|e2e)(?:\/[A-Za-z0-9_.-]+)*/g;

function rewriteRelativeSpecifier(
  file: string,
  specifier: string,
  moveMap: ReadonlyMap<string, string>,
): string {
  const oldTarget = posix.normalize(posix.join(dirname(file), specifier));
  const newTarget = moveMap.get(oldTarget) ?? oldTarget;
  const newFile = moveMap.get(file) ?? file;
  let candidate = posix.relative(dirname(newFile), newTarget);
  if (candidate.length === 0) {
    candidate = posix.basename(newTarget);
  }
  if (!candidate.startsWith(".")) {
    candidate = `./${candidate}`;
  }
  return candidate;
}

/** Rewrites relative imports and repository path references in place. */
export async function rewriteReferences(root: string, plan: LayoutPlan): Promise<number> {
  const moveMap = new Map(plan.moves.map((move) => [move.from, move.to] as const));
  const rewrites = pathRewriteTable(plan);
  const files = await walkAll(root, "");
  let changed = 0;

  for (const file of files) {
    const absolute = join(root, file);
    const original = await Bun.file(absolute).text();
    const next = rewriteFile(file, original, moveMap, rewrites);
    if (next !== original) {
      await Bun.write(absolute, next);
      changed += 1;
    }
  }
  return changed;
}

function rewriteFile(
  file: string,
  source: string,
  moveMap: ReadonlyMap<string, string>,
  rewrites: ReadonlyArray<readonly [string, string]>,
): string {
  let next = source;

  if (file.endsWith(".ts")) {
    next = next.replace(specifierPattern, (match: string, quote: string, specifier: string) => {
      if (!specifier.startsWith(".") || specifier.includes("*")) {
        return match;
      }
      const candidate = rewriteRelativeSpecifier(file, specifier, moveMap);
      if (candidate === specifier) {
        return match;
      }
      const prefix = match.slice(0, match.length - specifier.length - quote.length * 2);
      return `${prefix}${quote}${candidate}${quote}`;
    });
  }

  next = next.replace(repositoryPathPattern, (match: string) => {
    for (const [from, to] of rewrites) {
      if (match === from) {
        return to;
      }
      if (match.startsWith(`${from}/`)) {
        return `${to}${match.slice(from.length)}`;
      }
    }
    return match;
  });

  return next;
}

function isRewriteCandidate(name: string): boolean {
  if (name === "bun.lock") {
    return false;
  }
  return (
    name.endsWith(".ts") ||
    name.endsWith(".md") ||
    name.endsWith(".json") ||
    name.endsWith(".yml") ||
    name.endsWith(".yaml") ||
    name.endsWith(".toml") ||
    name.endsWith(".txt") ||
    name.endsWith(".jsonc")
  );
}

async function walkAll(root: string, directory: string): Promise<readonly string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".git" ||
      entry.name === "coverage" ||
      entry.name === "docs-site"
    ) {
      continue;
    }
    const relativePath = directory.length === 0 ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await walkAll(root, relativePath)));
      continue;
    }
    if (!entry.isFile() || !isRewriteCandidate(entry.name)) {
      continue;
    }
    files.push(relativePath);
  }
  return files;
}

/** Moves every planned file and prunes the directories that became empty. */
export async function moveFiles(root: string, plan: LayoutPlan): Promise<number> {
  if (plan.collisions.length > 0) {
    throw new Error(
      `Refusing to move: collisions\n- ${plan.collisions
        .map((collision) => `${collision.to} <- ${collision.from.join(", ")}`)
        .join("\n- ")}`,
    );
  }
  if (plan.multiKindFiles.length > 0) {
    throw new Error(
      `Refusing to move: multi-kind files must be split first\n- ${plan.multiKindFiles.join("\n- ")}`,
    );
  }

  let moved = 0;
  for (const move of plan.moves) {
    const to = join(root, move.to);
    await mkdir(dirname(to), { recursive: true });
    await rename(join(root, move.from), to);
    moved += 1;
  }

  await pruneEmptyDirectories(root);
  return moved;
}

async function pruneEmptyDirectories(root: string): Promise<void> {
  const packages = (await readdir(join(root, "packages"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const packageName of packages) {
    for (const area of ["src", "tests", "tests-vp", "e2e"]) {
      const directory = join(root, "packages", packageName, area);
      if (!(await pathExists(directory))) {
        continue;
      }
      if (await prune(directory)) {
        // `src` is the build root even when a package happens to own no source;
        // the old test directories are retired once nothing is left in them.
        if (area !== "src") {
          await rmdir(directory);
        }
      }
    }
  }
}

async function prune(directory: string): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true });
  let empty = true;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const childEmpty = await prune(join(directory, entry.name));
      if (childEmpty) {
        await rmdir(join(directory, entry.name));
      } else {
        empty = false;
      }
      continue;
    }
    empty = false;
  }
  return empty;
}

/**
 * Reports relative imports of a runtime source that no longer resolve.
 *
 * Specs and the CLI are excluded: a spec may embed generated source in a string
 * literal and the CLI emitter writes module specifiers as data, so both are
 * verified by their own test lane rather than by this textual scan.
 */
export async function findUnmovedImports(root: string): Promise<readonly string[]> {
  const files = await walkAll(root, "");
  const offenders: string[] = [];
  for (const file of files) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts") || file.startsWith("packages/cli/")) {
      continue;
    }
    const source = await Bun.file(join(root, file)).text();
    for (const match of source.matchAll(specifierPattern)) {
      const specifier = match[2] ?? "";
      if (!specifier.startsWith(".") || /[*?$]/.test(specifier)) {
        continue;
      }
      const target = posix.normalize(posix.join(dirname(file), specifier));
      if (!(await pathExists(join(root, target)))) {
        offenders.push(`${file} -> ${specifier}`);
      }
    }
  }
  return offenders.toSorted();
}

/** Resolves every relative Markdown link and reports the ones that do not exist. */
export async function findUnresolvedLinks(root: string): Promise<readonly string[]> {
  const glob = new Bun.Glob("**/*.md");
  const offenders: string[] = [];
  for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
    if (file.includes("node_modules") || file.startsWith("docs-site/")) {
      continue;
    }
    const source = await Bun.file(join(root, file)).text();
    for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? "";
      if (!target.startsWith(".") || target.includes("#")) {
        continue;
      }
      const resolved = posix.normalize(posix.join(dirname(file), target));
      if (!(await pathExists(join(root, resolved)))) {
        offenders.push(`${file} -> ${target}`);
      }
    }
  }
  return offenders.toSorted();
}

export interface CodemodOptions {
  readonly root?: string;
  readonly apply?: boolean;
  readonly writeMap?: boolean;
  readonly log?: (message: string) => void;
}

/** Runs the codemod: plan, optionally apply, then report. */
export async function runCodemod(options: CodemodOptions = {}): Promise<LayoutReport> {
  const root = options.root ?? resolve(import.meta.dir, "..");
  const log = options.log ?? console.log;
  const brokenLinksBefore = await findUnresolvedLinks(root);
  const plan = await planLayout(root);

  log(`Planned moves: ${plan.moves.length}`);
  log(`Multi-kind files: ${plan.multiKindFiles.length}`);
  log(`Collisions: ${plan.collisions.length}`);
  log(`Unmapped files: ${plan.unmappedFiles.length}`);

  for (const collision of plan.collisions) {
    log(`collision ${collision.to} <- ${collision.from.join(", ")}`);
  }
  for (const file of plan.multiKindFiles) {
    log(`multi-kind ${file}`);
  }
  for (const file of plan.unmappedFiles) {
    log(`unmapped ${file}`);
  }

  if (options.apply === true) {
    const rewritten = await rewriteReferences(root, plan);
    log(`Rewrote references in ${rewritten} files.`);
    const movedCount = await moveFiles(root, plan);
    if (options.writeMap === true) {
      await Bun.write(join(root, layoutMapPath), renderLayoutPlan(plan));
      log(`Wrote ${layoutMapPath}.`);
    }
    log(`Moved ${movedCount} files.`);
  }

  const unmovedImports =
    options.apply === true ? await findUnmovedImports(root) : ([] as readonly string[]);
  const unresolvedLinks = (await findUnresolvedLinks(root)).filter(
    (link) => !brokenLinksBefore.includes(link),
  );

  log(`Unmoved imports: ${unmovedImports.length}`);
  log(`Newly unresolved links: ${unresolvedLinks.length}`);
  for (const offender of unmovedImports) {
    log(`unmoved-import ${offender}`);
  }
  for (const offender of unresolvedLinks) {
    log(`unresolved-link ${offender}`);
  }

  return Object.freeze({
    movedCount: plan.moves.length,
    splitCount: plan.multiKindFiles.length,
    collisions: plan.collisions,
    multiKindFiles: plan.multiKindFiles,
    unmappedFiles: plan.unmappedFiles,
    unmovedImports: Object.freeze(unmovedImports),
    unresolvedLinks: Object.freeze(unresolvedLinks),
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  await runCodemod({
    apply: args.includes("--apply"),
    writeMap: args.includes("--write-map"),
    ...(rootFlag === -1 ? {} : { root: resolve(args[rootFlag + 1] ?? ".") }),
  });
}
