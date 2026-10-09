import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { GenerateSchematicResult, PendingFile } from "./schematic.types.ts";

export function createFile(directory: string, name: string, content: string): PendingFile {
  return { path: join(directory, name), content, kind: "CREATE" };
}

export async function writePendingFiles(
  projectRoot: string,
  files: readonly PendingFile[],
  dryRun: boolean,
): Promise<GenerateSchematicResult> {
  const creates = files.filter((file) => file.kind === "CREATE");
  for (const file of creates) {
    if (await Bun.file(file.path).exists()) {
      throw new Error(`File "${relative(projectRoot, file.path)}" already exists.`);
    }
  }

  if (!dryRun) {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      await Bun.write(file.path, file.content);
    }
  }

  return {
    dryRun,
    changes: files.map((file) => ({
      kind: file.kind,
      path: relative(projectRoot, file.path),
    })),
  };
}
