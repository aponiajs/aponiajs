import { lstat, mkdir, symlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { GenerateSchematicResult, PendingFile } from "./schematic.types.ts";

/** The aliases every generated agent guide carries beside its real file. */
export const agentGuideAliases = ["CLAUDE.md", "GEMINI.md"] as const;

export function createFile(directory: string, name: string, content: string): PendingFile {
  return { path: join(directory, name), content, kind: "CREATE", type: "content" };
}

/** Plans the relative symlinks that point every agent alias at `AGENTS.md`. */
export function createAgentGuideLinks(directory: string): PendingFile[] {
  return agentGuideAliases.map((alias) => ({
    path: join(directory, alias),
    link: "AGENTS.md",
    kind: "CREATE",
    type: "link",
  }));
}

export async function writePendingFiles(
  projectRoot: string,
  files: readonly PendingFile[],
  dryRun: boolean,
): Promise<GenerateSchematicResult> {
  const creates = files.filter((file) => file.kind === "CREATE");
  for (const file of creates) {
    if (await pathExists(file.path)) {
      throw new Error(`File "${relative(projectRoot, file.path)}" already exists.`);
    }
  }

  if (!dryRun) {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      if (file.type === "link") {
        await symlink(file.link, file.path);
      } else {
        await Bun.write(file.path, file.content);
      }
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
