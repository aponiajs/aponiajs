import { resolveDistribution, type DistributionTag } from "./distribution-tag.ts";

export const releaseBranchTags = Object.freeze({
  main: "latest",
  "release/alpha": "alpha",
  "release/beta": "beta",
  "release/rc": "rc",
} as const satisfies Readonly<Record<string, DistributionTag>>);

export type ReleaseBranch = keyof typeof releaseBranchTags;

export function assertReleaseBranch(branch: string, version: string): DistributionTag {
  const expectedTag = releaseBranchTags[branch as ReleaseBranch];
  if (!expectedTag) {
    throw new Error(
      `Branch "${branch}" is not a release branch. Use one of: ${Object.keys(releaseBranchTags).join(", ")}.`,
    );
  }

  const resolvedTag = resolveDistribution(version).tag;
  if (resolvedTag !== expectedTag) {
    throw new Error(
      `Branch "${branch}" publishes "${expectedTag}", but version ${version} resolves to "${resolvedTag}".`,
    );
  }

  return expectedTag;
}

if (import.meta.main) {
  const branch = Bun.argv[2] ?? Bun.env.GITHUB_REF_NAME;
  if (!branch) {
    throw new Error("Pass a release branch or set GITHUB_REF_NAME.");
  }

  const manifest = (await Bun.file("package.json").json()) as { version: string };
  const tag = assertReleaseBranch(branch, manifest.version);
  console.log(`Verified release branch "${branch}" for distribution tag "${tag}".`);
}
