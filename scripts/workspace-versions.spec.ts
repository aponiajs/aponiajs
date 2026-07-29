import { describe, expect, test } from "bun:test";
import {
  assertWorkspaceLockVersions,
  updateWorkspaceLockVersions,
  versionedWorkspacePaths,
} from "./workspace-versions.ts";

function lockfileFixture(version: string): string {
  const workspaces = Object.fromEntries(
    versionedWorkspacePaths.map((workspacePath) => [
      workspacePath,
      {
        name: workspacePath,
        version,
      },
    ]),
  );

  return `${JSON.stringify({ lockfileVersion: 1, workspaces }, null, 2)}\n`;
}

describe("Bun workspace version synchronization", () => {
  test("updates every versioned workspace without changing unrelated fields", () => {
    const updated = updateWorkspaceLockVersions(lockfileFixture("0.3.19"), "0.3.20");
    const parsed = JSON.parse(updated) as {
      readonly workspaces: Readonly<Record<string, { readonly name: string; version: string }>>;
    };

    for (const workspacePath of versionedWorkspacePaths) {
      expect(parsed.workspaces[workspacePath]).toEqual({
        name: workspacePath,
        version: "0.3.20",
      });
    }
  });

  test("rejects a stale workspace version", () => {
    expect(() => assertWorkspaceLockVersions(lockfileFixture("0.3.19"), "0.3.20")).toThrow(
      "Bun workspace lock versions do not match 0.3.20",
    );
  });

  test("accepts synchronized workspace versions", () => {
    expect(() => assertWorkspaceLockVersions(lockfileFixture("0.3.20"), "0.3.20")).not.toThrow();
  });

  test("rejects lockfiles without the complete workspace graph", () => {
    expect(() => updateWorkspaceLockVersions("{}", "0.3.20")).toThrow(
      "bun.lock does not declare workspaces.",
    );
    expect(() =>
      updateWorkspaceLockVersions(
        JSON.stringify({
          workspaces: {
            [versionedWorkspacePaths[0]]: { version: "0.3.19" },
          },
        }),
        "0.3.20",
      ),
    ).toThrow("bun.lock is missing workspaces:");
  });
});
