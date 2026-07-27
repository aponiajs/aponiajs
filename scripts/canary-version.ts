import { applyEdits, modify } from "jsonc-parser";
import { createCanaryVersion } from "./distribution-tag.ts";
import { synchronizeVersionReferences } from "./sync-version-references.ts";
import { versionedPackageFiles } from "./workspace-versions.ts";

const formattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
} as const;

/**
 * Stamps an unpublishable-by-accident canary version across every manifest.
 * Canary builds are produced by CI from a commit and are never committed back
 * to the repository, so this script writes files without touching Git.
 */
export async function stampCanaryVersion(commitSha: string, date = new Date()): Promise<string> {
  const rootManifest = (await Bun.file("package.json").json()) as { readonly version?: unknown };
  if (typeof rootManifest.version !== "string") {
    throw new Error("package.json does not declare a version.");
  }

  const canaryVersion = createCanaryVersion(rootManifest.version, commitSha, date);
  for (const file of versionedPackageFiles) {
    const manifest = await Bun.file(file).text();
    const edits = modify(manifest, ["version"], canaryVersion, { formattingOptions });
    await Bun.write(file, applyEdits(manifest, edits));
  }

  await synchronizeVersionReferences();
  return canaryVersion;
}

if (import.meta.main) {
  const commitSha = Bun.argv[2] ?? Bun.env.GITHUB_SHA;
  if (!commitSha) {
    throw new Error("Pass a commit SHA or set GITHUB_SHA before stamping a canary version.");
  }

  const canaryVersion = await stampCanaryVersion(commitSha);
  const outputPath = Bun.env.GITHUB_OUTPUT;
  if (outputPath) {
    await Bun.write(outputPath, `${await Bun.file(outputPath).text()}version=${canaryVersion}\n`);
  }

  console.log(`Stamped canary version ${canaryVersion}.`);
}
