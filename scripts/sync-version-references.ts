import { applyEdits, modify } from "jsonc-parser";
import { updateWorkspaceLockVersions } from "./workspace-versions.ts";

const benchmarkArtifacts = [
  "bun-http-framework-benchmark/results/results.md",
  "bun-http-framework-benchmark/results/bun/aponia.txt",
  "bun-http-framework-benchmark/environment.json",
] as const;

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
  let updated = document;
  for (const artifact of benchmarkArtifacts) {
    const pattern = new RegExp(
      `(benchmark-results/${escapeRegularExpression(artifact)}\\?v=)[0-9A-Za-z.+-]+`,
      "g",
    );
    const references = updated.match(pattern);
    if (references?.length !== 1) {
      throw new Error(
        `Expected exactly one ${artifact} version reference, found ${references?.length ?? 0}.`,
      );
    }
    updated = updated.replace(pattern, (_reference, prefix: string) => `${prefix}${version}`);
  }

  return updated;
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

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
