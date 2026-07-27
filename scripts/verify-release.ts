import { assertPublishable, resolveDistribution, semverPattern } from "./distribution-tag.ts";
import { assertWorkspaceLockVersions, versionedPackageFiles } from "./workspace-versions.ts";

const versions = await Promise.all(
  versionedPackageFiles.map(async (file) => {
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

assertWorkspaceLockVersions(await Bun.file("bun.lock").text(), version);

const expectedVersion = Bun.env.RELEASE_VERSION?.replace(/^v/, "");
if (expectedVersion && version !== expectedVersion) {
  throw new Error(
    `Release version ${expectedVersion} does not match workspace version ${version}.`,
  );
}

const expectedTag = Bun.env.RELEASE_TAG;
if (expectedTag) {
  assertPublishable(version, expectedTag);
}

const baseVersion = Bun.env.BASE_VERSION?.replace(/^v/, "");
if (baseVersion) {
  if (!semverPattern.test(baseVersion)) {
    throw new Error(`${baseVersion} is not a valid base SemVer version.`);
  }

  if (Bun.semver.order(version, baseVersion) <= 0) {
    throw new Error(`Workspace version must increase on every push: ${baseVersion} -> ${version}.`);
  }
}

console.log(`Verified synchronized release version ${version}.`);
console.log(
  distribution.aliases.length > 0
    ? `Distribution tag: ${distribution.tag} (alias: ${distribution.aliases.join(", ")}).`
    : `Distribution tag: ${distribution.tag}.`,
);

export {};
