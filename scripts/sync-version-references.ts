import { applyEdits, modify } from "jsonc-parser";
import { updateWorkspaceLockVersions } from "./workspace-versions.ts";

export function updateRoadmapVersion(roadmap: string, version: string): string {
  const edits = modify(roadmap, ["project", "currentVersion"], version, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    },
  });
  return applyEdits(roadmap, edits);
}

export async function synchronizeVersionReferences(
  manifestPath = "package.json",
  roadmapPath = "roadmap/roadmap.json",
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
