/** A newer version or deprecation warning from the npm registry. */
export interface PackageUpdateNotice {
  readonly packageName: string;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly deprecated?: string;
}

/** A known vulnerability / dangerous patch advisory from OSV. */
export interface SecurityAdvisoryNotice {
  readonly packageName: string;
  readonly currentVersion: string;
  readonly advisoryIds: readonly string[];
  readonly summary?: string;
  readonly fixedVersion?: string;
}

/** Result of checking installed packages against npm and OSV. */
export interface UpdateCheckReport {
  readonly checkedAt: number;
  readonly updates: readonly PackageUpdateNotice[];
  readonly advisories: readonly SecurityAdvisoryNotice[];
}

/** Persisted 24-hour update-check cache entry. */
export interface UpdateCacheEntry {
  readonly checkedAt: number;
  readonly report: UpdateCheckReport;
}

/** Injectable options for `checkForUpdatesAndAdvisories`. */
export interface UpdateCheckOptions {
  readonly cwd?: string;
  readonly cachePath?: string;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
  readonly cliVersion?: string;
}
