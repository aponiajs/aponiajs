import { assertPublishable, resolveDistribution, semverPattern } from "./distribution-tag.ts";
import { assertWorkspaceLockVersions, versionedPackageFiles } from "./workspace-versions.ts";

export interface VerifyReleaseOptions {
  readonly baseVersion?: string;
  readonly lockfilePath?: string;
  readonly log?: (message: string) => void;
  readonly packageFiles?: readonly string[];
  readonly releaseTag?: string;
  readonly releaseVersion?: string;
}

export async function verifyRelease(options: VerifyReleaseOptions = {}): Promise<void> {
  const packageFiles = options.packageFiles ?? versionedPackageFiles;
  const versions = await Promise.all(
    packageFiles.map(async (file) => {
      const manifest = (await Bun.file(file).json()) as { version?: unknown };
      if (typeof manifest.version !== "string") {
        throw new Error(`${file} does not declare a version.`);
      }

      return { file, version: manifest.version };
    }),
  );

  const uniqueVersions = new Set(versions.map(({ version }) => version));
  if (uniqueVersions.size !== 1) {
    const details = versions.map(({ file, version }) => `- ${file}: ${version}`).join("\n");
    throw new Error(`Workspace versions are not synchronized:\n${details}`);
  }

  const [version] = uniqueVersions;
  if (!version || !semverPattern.test(version)) {
    throw new Error(`${version ?? "undefined"} is not a valid SemVer version.`);
  }

  const distribution = resolveDistribution(version);
  assertWorkspaceLockVersions(await Bun.file(options.lockfilePath ?? "bun.lock").text(), version);

  const expectedVersion = options.releaseVersion?.replace(/^v/, "");
  if (expectedVersion && version !== expectedVersion) {
    throw new Error(
      `Release version ${expectedVersion} does not match workspace version ${version}.`,
    );
  }

  if (options.releaseTag) {
    assertPublishable(version, options.releaseTag);
  }

  const baseVersion = options.baseVersion?.replace(/^v/, "");
  if (baseVersion) {
    if (!semverPattern.test(baseVersion)) {
      throw new Error(`${baseVersion} is not a valid base SemVer version.`);
    }

    if (Bun.semver.order(version, baseVersion) <= 0) {
      throw new Error(
        `Workspace version must increase on every push: ${baseVersion} -> ${version}.`,
      );
    }
  }

  const log = options.log ?? console.log;
  log(`Verified synchronized release version ${version}.`);
  log(
    distribution.aliases.length > 0
      ? `Distribution tag: ${distribution.tag} (alias: ${distribution.aliases.join(", ")}).`
      : `Distribution tag: ${distribution.tag}.`,
  );
}

export interface VerifyReleaseEntryOptions {
  readonly baseVersion?: string | undefined;
  readonly log?: (message: string) => void;
  readonly releaseTag?: string | undefined;
  readonly releaseVersion?: string | undefined;
}

/**
 * Runs the release gate against the process release environment. CI exports
 * `BASE_VERSION`, `RELEASE_TAG`, and `RELEASE_VERSION`, so the entry point reads
 * them here and any explicit option wins over the environment.
 */
export async function verifyReleaseEntry(options: VerifyReleaseEntryOptions = {}): Promise<void> {
  await verifyRelease({
    baseVersion: options.baseVersion ?? Bun.env.BASE_VERSION,
    log: options.log ?? console.log,
    releaseTag: options.releaseTag ?? Bun.env.RELEASE_TAG,
    releaseVersion: options.releaseVersion ?? Bun.env.RELEASE_VERSION,
  });
}

if (import.meta.main) await verifyReleaseEntry();
