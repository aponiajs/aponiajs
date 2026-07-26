import { applyEdits, modify } from "jsonc-parser";
import { updateWorkspaceLockVersions } from "./workspace-versions.ts";

const benchmarkVersionPattern =
  /(benchmark-results\/elysia-overhead\.(?:svg|json)\?v=)[0-9A-Za-z.+-]+/g;

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

export function updateBenchmarkVersionReferences(document: string, version: string): string {
  const references = document.match(benchmarkVersionPattern);
  if (!references || references.length !== 2) {
    throw new Error(
      `Expected exactly two Elysia benchmark version references, found ${references?.length ?? 0}.`,
    );
  }

  return document.replace(
    benchmarkVersionPattern,
    (_reference, prefix: string) => `${prefix}${version}`,
  );
}

export async function synchronizeVersionReferences(
  manifestPath = "package.json",
  roadmapPath = "roadmap/roadmap.json",
  readmePaths: readonly string[] = ["README.md", "benchmarks/README.md"],
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

  for (const readmePath of readmePaths) {
    const readme = await Bun.file(readmePath).text();
    await Bun.write(readmePath, updateBenchmarkVersionReferences(readme, manifest.version));
  }

  const lockfile = await Bun.file(lockfilePath).text();
  await Bun.write(lockfilePath, updateWorkspaceLockVersions(lockfile, manifest.version));

  console.log(`Synchronized release references for ${manifest.version}.`);
}

if (import.meta.main) {
  await synchronizeVersionReferences();
}
