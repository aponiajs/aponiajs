import { updateWorkspaceLockVersions } from "./workspace-versions.ts";

const roadmapVersionPattern = /^(- \*\*Current version:\*\* ).+$/m;

export function updateRoadmapVersion(roadmap: string, version: string): string {
  if (!roadmapVersionPattern.test(roadmap)) {
    throw new Error("ROADMAP.md does not declare a current version.");
  }

  return roadmap.replace(roadmapVersionPattern, `$1${version}`);
}

export async function synchronizeVersionReferences(
  manifestPath = "package.json",
  roadmapPath = "ROADMAP.md",
  lockfilePath = "bun.lock",
): Promise<void> {
  const manifest = (await Bun.file(manifestPath).json()) as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== "string") {
    throw new Error(`${manifestPath} does not declare a version.`);
  }

  const roadmap = await Bun.file(roadmapPath).text();
  await Bun.write(roadmapPath, updateRoadmapVersion(roadmap, manifest.version));

  const lockfile = await Bun.file(lockfilePath).text();
  await Bun.write(lockfilePath, updateWorkspaceLockVersions(lockfile, manifest.version));

  console.log(`Synchronized release references for ${manifest.version}.`);
}

if (import.meta.main) {
  await synchronizeVersionReferences();
}
