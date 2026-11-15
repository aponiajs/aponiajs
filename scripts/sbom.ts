import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Enums, Models, Serialize, Spec } from "@cyclonedx/cyclonedx-library";
import { parse, type ParseError } from "jsonc-parser";

/** A `bun.lock` workspace entry: the manifest fields the lockfile repeats. */
interface BunLockWorkspace {
  readonly name?: unknown;
  readonly version?: unknown;
}

/** A `bun.lock` package entry: `[resolution, registry?, info?, integrity?]`. */
type BunLockPackage = readonly unknown[];

interface BunLock {
  readonly workspaces?: Readonly<Record<string, BunLockWorkspace>>;
  readonly packages?: Readonly<Record<string, BunLockPackage>>;
}

export interface SbomOptions {
  /** The lockfile to read. Defaults to the repository's `bun.lock`. */
  readonly lockfilePath?: string;
  /** The workspace manifest naming the SBOM's subject. Defaults to the root `package.json`. */
  readonly manifestPath?: string;
  /** Where to write the document. Omit to only return it. */
  readonly outputPath?: string;
  /**
   * The document timestamp. Defaults to now; a release lane passes the build
   * time so two runs over one commit produce one document.
   */
  readonly timestamp?: string;
}

/**
 * Generates a CycloneDX 1.5 SBOM from `bun.lock`.
 *
 * The inventory is every package the lockfile resolved, plus every workspace
 * member the lockfile names. Each registry component carries its `bun.lock`
 * integrity as a SHA-512 (or weaker) hash, hex-encoded as CycloneDX requires.
 * The document is assembled with the CycloneDX project's own library, so the
 * shape is the specification's rather than one this repository invented.
 *
 * The serial number is derived from the sorted component list, so the same
 * lockfile produces the same document identifier on every machine.
 *
 * @param options - Paths and the timestamp to stamp.
 * @returns The serialized CycloneDX JSON document.
 * @throws A `TypeError` when either input is not the JSON its name promises.
 */
export async function generateSbom(options: SbomOptions = {}): Promise<string> {
  const lockfilePath = options.lockfilePath ?? resolve(import.meta.dir, "..", "bun.lock");
  const manifestPath = options.manifestPath ?? resolve(import.meta.dir, "..", "package.json");

  const manifest = (await Bun.file(manifestPath).json()) as {
    readonly name?: unknown;
    readonly version?: unknown;
  };
  const lock = parseLockfile(lockfilePath, await Bun.file(lockfilePath).text());

  const components = new Map<string, Models.Component>();
  for (const entry of Object.values(lock.packages ?? {})) {
    const component = packageComponent(entry);
    if (component !== undefined) {
      components.set(component.purl ?? component.name, component);
    }
  }
  for (const [path, workspace] of Object.entries(lock.workspaces ?? {})) {
    if (path === "" || typeof workspace.name !== "string") {
      continue;
    }
    const version = typeof workspace.version === "string" ? workspace.version : undefined;
    const key = `${workspace.name}@${version ?? "workspace"}`;
    components.set(
      key,
      new Models.Component(Enums.ComponentType.Library, workspace.name, {
        ...(version === undefined ? {} : { version }),
        ...(version === undefined ? {} : { purl: purlOf(workspace.name, version) }),
        bomRef: key,
      }),
    );
  }

  const sorted = [...components.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, component]) => component);
  const bom = new Models.Bom({
    version: 1,
    serialNumber: serialNumberFor(sorted),
    metadata: new Models.Metadata({
      timestamp: new Date(options.timestamp ?? new Date().toISOString()),
      component: new Models.Component(
        Enums.ComponentType.Application,
        typeof manifest.name === "string" ? manifest.name : "workspace",
        {
          ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
          bomRef: "workspace-root",
        },
      ),
    }),
  });
  for (const component of sorted) {
    bom.components.add(component);
  }

  const serializer = new Serialize.JsonSerializer(
    new Serialize.JSON.Normalize.Factory(Spec.Spec1dot5),
  );
  const document = `${serializer.serialize(bom, { sortLists: true, space: 2 })}\n`;
  if (options.outputPath !== undefined) {
    await Bun.write(options.outputPath, document);
  }
  return document;
}

function parseLockfile(path: string, text: string): BunLock {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new TypeError(
      `${path} is not valid JSONC: first error at offset ${errors[0]?.offset ?? 0}.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError(`${path} must contain a JSON object.`);
  }
  return parsed as BunLock;
}

function packageComponent(entry: BunLockPackage): Models.Component | undefined {
  const resolution = entry[0];
  if (typeof resolution !== "string" || resolution.includes("workspace:")) {
    return undefined;
  }

  const parsed = splitResolution(resolution);
  if (parsed === undefined || parsed.version === "") {
    return undefined;
  }

  const purl = purlOf(parsed.name, parsed.version);
  const component = new Models.Component(Enums.ComponentType.Library, parsed.name, {
    version: parsed.version,
    purl,
    bomRef: purl,
  });

  const integrity = typeof entry[3] === "string" ? entry[3] : undefined;
  const parsedIntegrity = integrity === undefined ? undefined : parseIntegrity(integrity);
  if (parsedIntegrity !== undefined) {
    component.hashes.set(parsedIntegrity.algorithm, parsedIntegrity.content);
  }

  return component;
}

/** Splits `name@version`; Bun resolves an alias to the real package before writing the lockfile. */
function splitResolution(resolution: string): { name: string; version: string } | undefined {
  const separator = resolution.lastIndexOf("@");
  if (separator <= 0) {
    return undefined;
  }
  return { name: resolution.slice(0, separator), version: resolution.slice(separator + 1) };
}

function parseIntegrity(
  integrity: string,
): { algorithm: Enums.HashAlgorithm; content: string } | undefined {
  const separator = integrity.indexOf("-");
  if (separator < 0) {
    return undefined;
  }
  const algorithm = integrityAlgorithm(integrity.slice(0, separator));
  if (algorithm === undefined) {
    return undefined;
  }
  // `bun.lock` stores the base64 form npm publishes; CycloneDX states hex.
  return {
    algorithm,
    content: Buffer.from(integrity.slice(separator + 1), "base64").toString("hex"),
  };
}

function integrityAlgorithm(name: string): Enums.HashAlgorithm | undefined {
  switch (name) {
    case "sha512":
      return Enums.HashAlgorithm["SHA-512"];
    case "sha384":
      return Enums.HashAlgorithm["SHA-384"];
    case "sha256":
      return Enums.HashAlgorithm["SHA-256"];
    case "sha1":
      return Enums.HashAlgorithm["SHA-1"];
    default:
      return undefined;
  }
}

function purlOf(name: string, version: string): string {
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

/** A UUID-shaped identifier derived from the component list, so it is reproducible. */
function serialNumberFor(components: readonly Models.Component[]): string {
  const digest = createHash("sha256")
    .update(components.map((component) => component.bomRef.value).join("\n"))
    .digest("hex");
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${((Number.parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
  return `urn:uuid:${uuid}`;
}

if (import.meta.main) {
  const outputPath = process.argv[2] ?? resolve(import.meta.dir, "..", "sbom.cdx.json");
  const document = await generateSbom({ outputPath });
  console.log(`Wrote ${outputPath} (${document.length} bytes).`);
}
