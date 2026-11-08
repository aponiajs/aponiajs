import { applyEdits, modify, parse } from "jsonc-parser";

export const versionedPackageFiles = [
  "package.json",
  "packages/aponiajs/package.json",
  "packages/auth/package.json",
  "packages/audit/package.json",
  "packages/cache/package.json",
  "packages/cli/package.json",
  "packages/common/package.json",
  "packages/compression/package.json",
  "packages/core/package.json",
  "packages/cors/package.json",
  "packages/create-aponia/package.json",
  "packages/database/package.json",
  "packages/cron/package.json",
  "packages/devtools/package.json",
  "packages/events/package.json",
  "packages/graphql/package.json",
  "packages/http/package.json",
  "packages/idempotency/package.json",
  "packages/mcp/package.json",
  "packages/metrics/package.json",
  "packages/microservices/package.json",
  "packages/serverless/package.json",
  "packages/openapi/package.json",
  "packages/opentelemetry/package.json",
  "packages/platform-elysia/package.json",
  "packages/queue/package.json",
  "packages/rate-limit/package.json",
  "packages/security/package.json",
  "packages/session/package.json",
  "packages/tenancy/package.json",
  "packages/testing/package.json",
] as const;

export const versionedWorkspacePaths = [
  "packages/aponiajs",
  "packages/auth",
  "packages/audit",
  "packages/cache",
  "packages/cli",
  "packages/common",
  "packages/compression",
  "packages/core",
  "packages/cors",
  "packages/create-aponia",
  "packages/cron",
  "packages/database",
  "packages/devtools",
  "packages/events",
  "packages/graphql",
  "packages/http",
  "packages/idempotency",
  "packages/mcp",
  "packages/metrics",
  "packages/microservices",
  "packages/serverless",
  "packages/openapi",
  "packages/opentelemetry",
  "packages/platform-elysia",
  "packages/queue",
  "packages/rate-limit",
  "packages/security",
  "packages/session",
  "packages/tenancy",
  "packages/testing",
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
