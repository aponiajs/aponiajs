import { applyEdits, modify, parse } from "jsonc-parser";

export const versionedPackageFiles = [
  "package.json",
  "packages/aponiajs/package.json",
  "packages/cli/package.json",
  "packages/common/package.json",
  "packages/core/package.json",
  "packages/create-aponia/package.json",
  "packages/platform-elysia/package.json",
] as const;

export const versionedWorkspacePaths = [
  "packages/aponiajs",
  "packages/cli",
  "packages/common",
  "packages/core",
  "packages/create-aponia",
  "packages/platform-elysia",
] as const;

interface BunLockfile {
  readonly workspaces?: Readonly<
    Record<
      string,
      {
        readonly version?: unknown;
      }
    >
  >;
}

const formattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
} as const;

export function updateWorkspaceLockVersions(lockfile: string, version: string): string {
  const parsed = parseLockfile(lockfile);
  assertWorkspacePathsExist(parsed);

  return versionedWorkspacePaths.reduce((updatedLockfile, workspacePath) => {
    const edits = modify(updatedLockfile, ["workspaces", workspacePath, "version"], version, {
      formattingOptions,
    });
    return applyEdits(updatedLockfile, edits);
  }, lockfile);
}

export function assertWorkspaceLockVersions(lockfile: string, version: string): void {
  const parsed = parseLockfile(lockfile);
  assertWorkspacePathsExist(parsed);

  const staleWorkspaces = versionedWorkspacePaths.filter(
    (workspacePath) => parsed.workspaces?.[workspacePath]?.version !== version,
  );
  if (staleWorkspaces.length === 0) {
    return;
  }

  const details = staleWorkspaces
    .map(
      (workspacePath) =>
        `- ${workspacePath}: ${String(parsed.workspaces?.[workspacePath]?.version)}`,
    )
    .join("\n");
  throw new Error(`Bun workspace lock versions do not match ${version}:\n${details}`);
}

function parseLockfile(lockfile: string): BunLockfile {
  const parsed = parse(lockfile) as BunLockfile;
  if (!parsed.workspaces) {
    throw new Error("bun.lock does not declare workspaces.");
  }
  return parsed;
}

function assertWorkspacePathsExist(lockfile: BunLockfile): void {
  const missingWorkspaces = versionedWorkspacePaths.filter(
    (workspacePath) => !lockfile.workspaces?.[workspacePath],
  );
  if (missingWorkspaces.length > 0) {
    throw new Error(`bun.lock is missing workspaces: ${missingWorkspaces.join(", ")}.`);
  }
}
