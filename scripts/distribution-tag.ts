import { appendFile } from "node:fs/promises";

export const distributionTags = ["latest", "alpha", "beta", "rc", "next", "canary"] as const;

export type DistributionTag = (typeof distributionTags)[number];

export const prereleaseIdentifiers = ["alpha", "beta", "rc", "canary"] as const;

export type PrereleaseIdentifier = (typeof prereleaseIdentifiers)[number];

export interface ParsedVersion {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
  readonly identifier: PrereleaseIdentifier | undefined;
  readonly build: string | undefined;
}

export interface ResolvedDistribution {
  readonly version: string;
  readonly tag: DistributionTag;
  readonly aliases: readonly DistributionTag[];
}

export const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Distribution tag per release channel. `next` is never a primary tag: it is an
 * alias that always points at the newest alpha, beta, or release candidate.
 */
const primaryTagByIdentifier: Readonly<Record<PrereleaseIdentifier, DistributionTag>> = {
  alpha: "alpha",
  beta: "beta",
  rc: "rc",
  canary: "canary",
};

const aliasTagsByIdentifier: Readonly<Record<PrereleaseIdentifier, readonly DistributionTag[]>> = {
  alpha: ["next"],
  beta: ["next"],
  rc: ["next"],
  canary: [],
};

export function parseVersion(version: string): ParsedVersion {
  const match = semverPattern.exec(version);
  if (!match) {
    throw new Error(`${version} is not a valid SemVer version.`);
  }

  const [, major, minor, patch, prerelease, build] = match;
  return Object.freeze({
    version,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
    identifier: prerelease ? assertPrereleaseIdentifier(version, prerelease) : undefined,
    build,
  });
}

export function resolveDistribution(version: string): ResolvedDistribution {
  const parsed = parseVersion(version);
  if (!parsed.identifier) {
    return Object.freeze({ version, tag: "latest", aliases: Object.freeze([]) });
  }

  return Object.freeze({
    version,
    tag: primaryTagByIdentifier[parsed.identifier],
    aliases: Object.freeze([...aliasTagsByIdentifier[parsed.identifier]]),
  });
}

/**
 * Guards a requested publication against the version it would publish, so a
 * prerelease can never take the `latest` tag and a stable release can never be
 * hidden behind a prerelease channel.
 */
export function assertPublishable(version: string, tag: string): void {
  if (!isDistributionTag(tag)) {
    throw new Error(
      `${tag} is not a supported distribution tag. Use one of: ${distributionTags.join(", ")}.`,
    );
  }

  const distribution = resolveDistribution(version);
  const allowed = [distribution.tag, ...distribution.aliases];
  if (!allowed.includes(tag)) {
    throw new Error(
      `Version ${version} may only be published under: ${allowed.join(", ")}. Received ${tag}.`,
    );
  }
}

export function isDistributionTag(tag: string): tag is DistributionTag {
  return (distributionTags as readonly string[]).includes(tag);
}

export function createCanaryVersion(baseVersion: string, commitSha: string, date: Date): string {
  const parsed = parseVersion(baseVersion);
  if (parsed.identifier && parsed.identifier !== "canary") {
    throw new Error(`Canary versions cannot be derived from the ${parsed.identifier} channel.`);
  }

  const shortSha = commitSha.trim().slice(0, 7);
  if (!/^[0-9a-f]{7}$/.test(shortSha)) {
    throw new Error(`${commitSha} is not a commit SHA.`);
  }

  const stamp = date
    .toISOString()
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 14);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}-canary.${stamp}.${shortSha}`;
}

function assertPrereleaseIdentifier(version: string, prerelease: string): PrereleaseIdentifier {
  const [identifier] = prerelease.split(".");
  if (!identifier || !(prereleaseIdentifiers as readonly string[]).includes(identifier)) {
    throw new Error(
      `Version ${version} uses an unsupported prerelease identifier. Use one of: ${prereleaseIdentifiers.join(", ")}.`,
    );
  }

  return identifier as PrereleaseIdentifier;
}

export interface DistributionTagEntryOptions {
  readonly log?: (message: string) => void;
  readonly manifestPath?: string;
  readonly outputPath?: string;
  readonly version?: string | undefined;
}

/**
 * Resolves the distribution tag of the version passed on the command line, or of
 * the workspace manifest when the pipeline passes none, and appends the result
 * to the GitHub Actions output file when `GITHUB_OUTPUT` is set. Appending
 * creates that file, because a pipeline may run the script before the file
 * exists; a path whose directory is missing or unwritable still fails.
 */
export async function resolveDistributionEntry(
  options: DistributionTagEntryOptions = {},
): Promise<ResolvedDistribution> {
  const version =
    options.version ?? (await readManifestVersion(options.manifestPath ?? "package.json"));
  const distribution = resolveDistribution(version);
  const outputPath = options.outputPath ?? Bun.env.GITHUB_OUTPUT;

  if (outputPath) {
    await appendFile(
      outputPath,
      `version=${distribution.version}\ntag=${distribution.tag}\naliases=${distribution.aliases.join(" ")}\n`,
    );
  }

  const log = options.log ?? console.log;
  log(`${distribution.version} publishes to "${distribution.tag}".`);
  if (distribution.aliases.length > 0) {
    log(`Alias tags: ${distribution.aliases.join(", ")}.`);
  }

  return distribution;
}

async function readManifestVersion(path: string): Promise<string> {
  const manifest = (await Bun.file(path).json()) as { version: string };
  return manifest.version;
}

if (import.meta.main) await resolveDistributionEntry({ version: Bun.argv[2] });
