/**
 * The frozen public API surface of every published package.
 *
 * The snapshot is the contract: an export that appears, disappears, or changes
 * between a value and a type fails the guard until it is frozen deliberately
 * with `bun run api:freeze`. Only `src/index.ts` is read, because the source
 * layout guard already makes it the only public barrel.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One name a barrel exports. */
export interface PublicExport {
  readonly name: string;
  readonly kind: "value" | "type";
}

/** The surface one package publishes. */
export interface PackageSurface {
  readonly name: string;
  readonly exports: readonly PublicExport[];
}

interface SnapshotPackage {
  readonly name: string;
  readonly exports: readonly { readonly name: string; readonly kind: "value" | "type" }[];
}

interface Snapshot {
  readonly contractVersion: number;
  readonly packages: readonly SnapshotPackage[];
}

/** Options the collector and the two entry points accept. */
export interface PublicApiOptions {
  /** The workspace root holding `packages/`; defaults to the process directory. */
  readonly workspaceRoot?: string;
  /** The snapshot file; defaults to `docs/public-api.json`. */
  readonly snapshotPath?: string;
  /** Where the entry point reports what it did. */
  readonly log?: (message: string) => void;
}

const snapshotVersion = 1;
const exportBlock = /export\s+(type\s+)?\{([\s\S]*?)\}/g;
const declaredExport =
  /export\s+(?:declare\s+)?(const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g;

/** Parses the export names one barrel states. */
export function parseBarrel(source: string): readonly PublicExport[] {
  if (/export\s+\*/.test(source)) {
    throw new Error("A barrel with `export *` cannot be frozen by name; list its exports.");
  }
  const exports = new Map<string, "value" | "type">();
  for (const match of source.matchAll(exportBlock)) {
    const kind = match[1] === undefined ? "value" : "type";
    for (const entry of splitSpecifiers(match[2] ?? "")) {
      exports.set(entry[1], kind);
    }
  }
  for (const match of source.matchAll(declaredExport)) {
    const keyword = match[1];
    const name = match[2];
    if (keyword === undefined || name === undefined) {
      continue;
    }
    exports.set(name, keyword === "interface" || keyword === "type" ? "type" : "value");
  }
  return Object.freeze(
    [...exports.entries()]
      .map(([name, kind]) => Object.freeze({ name, kind }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
  );
}

function splitSpecifiers(block: string): readonly (readonly [string, string])[] {
  return block
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [original, alias] = part.split(/\s+as\s+/);
      return [original ?? "", alias ?? original ?? ""] as const;
    });
}

/** Collects the surface of every published workspace package. */
export async function collectPublicApi(
  workspaceRoot = process.cwd(),
): Promise<readonly PackageSurface[]> {
  const packagesRoot = join(workspaceRoot, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const surfaces: PackageSurface[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const manifestPath = join(packagesRoot, entry.name, "package.json");
    const manifest = (await readFile(manifestPath, "utf8").then((text) => JSON.parse(text))) as {
      readonly name?: unknown;
      readonly private?: unknown;
    };
    if (manifest.private === true || typeof manifest.name !== "string") {
      continue;
    }
    const barrelPath = join(packagesRoot, entry.name, "src", "index.ts");
    // A bin-only package such as `create-aponia` publishes an executable, not
    // a module surface; its command line is covered by its own tests.
    if (!(await Bun.file(barrelPath).exists())) {
      continue;
    }
    const barrel = await readFile(barrelPath, "utf8");
    surfaces.push(Object.freeze({ name: manifest.name, exports: parseBarrel(barrel) }));
  }
  return Object.freeze(surfaces.toSorted((left, right) => left.name.localeCompare(right.name)));
}

/** Renders the snapshot exactly as the committed file stores it. */
export function serializeSnapshot(
  surfaces: readonly PackageSurface[],
  contractVersion = snapshotVersion,
): string {
  const snapshot: Snapshot = {
    contractVersion,
    packages: [...surfaces]
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((surface) => ({
        name: surface.name,
        exports: [...surface.exports]
          .toSorted((left, right) => left.name.localeCompare(right.name))
          .map((entry) => ({ name: entry.name, kind: entry.kind })),
      })),
  };
  return `${JSON.stringify(snapshot, undefined, 2)}\n`;
}

/** Describes every difference between the current surface and a snapshot. */
export function diffSnapshot(
  surfaces: readonly PackageSurface[],
  snapshot: Snapshot,
): readonly string[] {
  const differences: string[] = [];
  const current = new Map(surfaces.map((surface) => [surface.name, surface]));
  for (const frozen of snapshot.packages) {
    const actual = current.get(frozen.name);
    if (actual === undefined) {
      differences.push(`${frozen.name} is no longer published`);
      continue;
    }
    const frozenNames = new Map(frozen.exports.map((entry) => [entry.name, entry.kind]));
    const actualNames = new Map(actual.exports.map((entry) => [entry.name, entry.kind]));
    for (const [name, kind] of frozenNames) {
      const currentKind = actualNames.get(name);
      if (currentKind === undefined) {
        differences.push(`${frozen.name}: ${name} was removed`);
      } else if (currentKind !== kind) {
        differences.push(`${frozen.name}: ${name} changed from a ${kind} to a ${currentKind}`);
      }
    }
    for (const [name, kind] of actualNames) {
      if (!frozenNames.has(name)) {
        differences.push(`${frozen.name}: ${name} (${kind}) was added`);
      }
    }
    current.delete(frozen.name);
  }
  for (const name of current.keys()) {
    differences.push(`${name} is not in the frozen snapshot`);
  }
  return Object.freeze(differences);
}

/** Reads the snapshot a workspace commits. */
export async function readSnapshot(snapshotPath: string): Promise<Snapshot> {
  const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
  if (parsed.contractVersion !== snapshotVersion) {
    throw new Error(
      `Snapshot contract version ${parsed.contractVersion} is not ${snapshotVersion}.`,
    );
  }
  return parsed;
}

/** Fails when the live surface and the committed snapshot disagree. */
export async function verifyPublicApi(options: PublicApiOptions = {}): Promise<void> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const snapshotPath = options.snapshotPath ?? join(workspaceRoot, "docs", "public-api.json");
  const surfaces = await collectPublicApi(workspaceRoot);
  const snapshot = await readSnapshot(snapshotPath);
  const differences = diffSnapshot(surfaces, snapshot);
  if (differences.length > 0) {
    throw new Error(
      [
        "The public API no longer matches docs/public-api.json:",
        ...differences.map((difference) => `- ${difference}`),
        "Freeze the change deliberately with `bun run api:freeze`.",
      ].join("\n"),
    );
  }
}

/** Writes the current surface as the committed snapshot. */
export async function freezePublicApi(options: PublicApiOptions = {}): Promise<void> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const snapshotPath = options.snapshotPath ?? join(workspaceRoot, "docs", "public-api.json");
  const surfaces = await collectPublicApi(workspaceRoot);
  await writeFile(snapshotPath, serializeSnapshot(surfaces));
  const log = options.log ?? (() => {});
  log(`Froze ${surfaces.length} package surfaces in ${snapshotPath}.`);
}

/** Runs the entry point the package script calls. */
export async function runPublicApiEntry(
  options: PublicApiOptions & { readonly update?: boolean } = {},
): Promise<void> {
  if (options.update === true) {
    await freezePublicApi(options);
    return;
  }
  await verifyPublicApi(options);
  (options.log ?? (() => {}))("The public API matches docs/public-api.json.");
}

if (import.meta.main) {
  await runPublicApiEntry({
    update: process.argv.includes("--update"),
    log: (message) => console.log(message),
  });
}
