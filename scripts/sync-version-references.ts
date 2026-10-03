import { updateWorkspaceLockVersions } from "./workspace-versions.ts";

export async function synchronizeVersionReferences(
  manifestPath = "package.json",
  lockfilePath = "bun.lock",
): Promise<void> {
  const manifest = (await Bun.file(manifestPath).json()) as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== "string") {
    throw new Error(`${manifestPath} does not declare a version.`);
  }

  const lockfile = await Bun.file(lockfilePath).text();
  await Bun.write(lockfilePath, updateWorkspaceLockVersions(lockfile, manifest.version));

  console.log(`Synchronized release references for ${manifest.version}.`);
}

if (import.meta.main) await synchronizeVersionReferences();
