import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  PackageUpdateNotice,
  SecurityAdvisoryNotice,
  UpdateCacheEntry,
  UpdateCheckOptions,
  UpdateCheckReport,
} from "../interfaces/update-notifier.interface.ts";
import { aponiaVersion } from "../version.ts";

const defaultTimeoutMs = 1_500;
const defaultCacheTtlMs = 24 * 60 * 60 * 1_000;
const watchedExternalPackages = new Set([
  "elysia",
  "hono",
  "h3",
  "redis",
  "drizzle-orm",
  "croner",
  "graphql-yoga",
]);

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (number | string)[];
}

interface PackageSpec {
  readonly name: string;
  readonly version: string;
}

interface NpmAbbreviatedManifest {
  readonly "dist-tags"?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, { readonly deprecated?: string }>>;
}

interface OsvBatchResponse {
  readonly results?: readonly {
    readonly vulns?: readonly {
      readonly id: string;
      readonly summary?: string;
      readonly affected?: readonly {
        readonly ranges?: readonly {
          readonly events?: readonly { readonly fixed?: string }[];
        }[];
      }[];
    }[];
  }[];
}

/** Parses a `major.minor.patch[-prerelease]` version string. */
export function parseSemver(raw: string): ParsedSemver | undefined {
  const cleaned = raw.trim().replace(/^[~^=v]+/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(cleaned);
  if (match === null) {
    return undefined;
  }
  const prerelease =
    match[4] === undefined
      ? []
      : match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

/** Compares two SemVer strings (`> 0` if `a > b`, `< 0` if `a < b`, `0` if equal). */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === undefined || pb === undefined) {
    return 0;
  }
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const length = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const left = pa.prerelease[i];
    const right = pb.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") return left - right;
    if (typeof left === "number") return -1;
    if (typeof right === "number") return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

/** Resolves the default local cache file path. */
export function defaultUpdateCachePath(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "aponia", "update-check.json");
}

/**
 * Checks installed `@aponiajs/*` packages and core runtime dependencies for
 * newer releases, npm deprecation notices, and OSV security advisories.
 * Never throws: returns `undefined` on offline/timeout/error.
 */
export async function checkForUpdatesAndAdvisories(
  options: UpdateCheckOptions = {},
): Promise<UpdateCheckReport | undefined> {
  const now = options.now ?? Date.now;
  const currentMs = now();
  const cachePath = options.cachePath ?? defaultUpdateCachePath();
  const cacheTtlMs = options.cacheTtlMs ?? defaultCacheTtlMs;

  const cached = readCache(cachePath, currentMs, cacheTtlMs);
  if (cached !== undefined) {
    return cached;
  }

  const packages = collectInstalledPackages(
    resolve(options.cwd ?? process.cwd()),
    options.cliVersion ?? aponiaVersion,
  );
  if (packages.length === 0) {
    return undefined;
  }

  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const aponiaPackages = packages.filter((pkg) => pkg.name.startsWith("@aponiajs/"));

  try {
    const [updates, advisories] = await Promise.all([
      checkNpmUpdates(aponiaPackages, fetchImpl, timeoutMs),
      checkOsvAdvisories(packages, fetchImpl, timeoutMs),
    ]);

    const report: UpdateCheckReport = {
      checkedAt: currentMs,
      updates,
      advisories,
    };
    writeCache(cachePath, { checkedAt: currentMs, report });
    return report;
  } catch {
    return undefined;
  }
}

/** Formats a concise stderr warning banner, or returns `undefined` when clean. */
export function formatUpdateAdvisoryBanner(report: UpdateCheckReport): string | undefined {
  if (report.advisories.length === 0 && report.updates.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  if (report.advisories.length > 0) {
    lines.push("[aponia] SECURITY / DANGEROUS PATCH ADVISORY:");
    for (const advisory of report.advisories) {
      const fix =
        advisory.fixedVersion !== undefined ? ` -> upgrade to >= ${advisory.fixedVersion}` : "";
      const summary = advisory.summary !== undefined ? ` (${advisory.summary})` : "";
      lines.push(
        `  - ${advisory.packageName}@${advisory.currentVersion}: ${advisory.advisoryIds.join(", ")}${fix}${summary}`,
      );
    }
  }

  if (report.updates.length > 0) {
    lines.push("[aponia] Package updates / notices available:");
    for (const update of report.updates) {
      if (update.deprecated !== undefined) {
        lines.push(
          `  - ${update.packageName}@${update.currentVersion} DEPRECATED: ${update.deprecated}`,
        );
      } else if (update.latestVersion !== undefined) {
        lines.push(
          `  - ${update.packageName}: ${update.currentVersion} -> ${update.latestVersion}`,
        );
      }
    }
  }

  return lines.join("\n");
}

function collectInstalledPackages(cwd: string, cliVersion: string): PackageSpec[] {
  const found = new Map<string, string>();
  found.set("@aponiajs/cli", cliVersion);

  const manifestPath = join(cwd, "package.json");
  if (!existsSync(manifestPath)) {
    return [...found.entries()].map(([name, version]) => ({ name, version }));
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      readonly private?: boolean;
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [name, rawVersion] of Object.entries(deps)) {
      if (typeof rawVersion !== "string" || rawVersion.startsWith("workspace:")) {
        continue;
      }
      if (!name.startsWith("@aponiajs/") && !watchedExternalPackages.has(name)) {
        continue;
      }
      const parsed = parseSemver(rawVersion);
      if (parsed !== undefined) {
        found.set(name, rawVersion.replace(/^[~^=v]+/, ""));
      }
    }
  } catch {
    // Ignore unreadable/malformed package.json
  }

  return [...found.entries()].map(([name, version]) => ({ name, version }));
}

async function checkNpmUpdates(
  packages: readonly PackageSpec[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<readonly PackageUpdateNotice[]> {
  const notices: PackageUpdateNotice[] = [];
  await Promise.all(
    packages.map(async (pkg) => {
      try {
        const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
          headers: { accept: "application/vnd.npm.install-v1+json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as NpmAbbreviatedManifest;
        const deprecated = data.versions?.[pkg.version]?.deprecated;
        const candidateTag = pickChannelTag(pkg.version, data["dist-tags"]);
        const hasNewer = candidateTag !== undefined && compareSemver(candidateTag, pkg.version) > 0;
        if (deprecated !== undefined || hasNewer) {
          notices.push({
            packageName: pkg.name,
            currentVersion: pkg.version,
            latestVersion: hasNewer ? candidateTag : undefined,
            deprecated,
          });
        }
      } catch {
        // Ignore individual registry lookup failures
      }
    }),
  );
  return notices;
}

function pickChannelTag(
  currentVersion: string,
  tags: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (tags === undefined) {
    return undefined;
  }
  const parsed = parseSemver(currentVersion);
  if (parsed !== undefined && typeof parsed.prerelease[0] === "string") {
    const channel = parsed.prerelease[0];
    const channelTag = tags[channel];
    if (channelTag !== undefined && tags.latest !== undefined) {
      return compareSemver(tags.latest, channelTag) > 0 ? tags.latest : channelTag;
    }
    return channelTag ?? tags.latest;
  }
  return tags.latest;
}

async function checkOsvAdvisories(
  packages: readonly PackageSpec[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<readonly SecurityAdvisoryNotice[]> {
  if (packages.length === 0) {
    return [];
  }
  try {
    const res = await fetchImpl("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        queries: packages.map((pkg) => ({
          package: { name: pkg.name, ecosystem: "npm" },
          version: pkg.version,
        })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return [];
    }
    const payload = (await res.json()) as OsvBatchResponse;
    const advisories: SecurityAdvisoryNotice[] = [];
    const results = payload.results ?? [];
    for (let i = 0; i < results.length && i < packages.length; i += 1) {
      const vulns = results[i]?.vulns;
      if (vulns === undefined || vulns.length === 0) {
        continue;
      }
      const pkg = packages[i]!;
      const fixedVersion = vulns
        .flatMap((v) => v.affected ?? [])
        .flatMap((a) => a.ranges ?? [])
        .flatMap((r) => r.events ?? [])
        .map((e) => e.fixed)
        .find((f): f is string => typeof f === "string");
      advisories.push({
        packageName: pkg.name,
        currentVersion: pkg.version,
        advisoryIds: vulns.map((v) => v.id),
        summary: vulns[0]?.summary,
        fixedVersion,
      });
    }
    return advisories;
  } catch {
    return [];
  }
}

function readCache(cachePath: string, nowMs: number, ttlMs: number): UpdateCheckReport | undefined {
  try {
    if (!existsSync(cachePath)) {
      return undefined;
    }
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as UpdateCacheEntry;
    if (nowMs - parsed.checkedAt >= ttlMs) {
      return undefined;
    }
    return parsed.report;
  } catch {
    return undefined;
  }
}

function writeCache(cachePath: string, entry: UpdateCacheEntry): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(entry), "utf8");
  } catch {
    // Best-effort cache write
  }
}
