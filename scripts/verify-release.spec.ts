import { describe, expect, test } from "bun:test";

const currentVersion = ((await Bun.file("package.json").json()) as { version: string }).version;

function verifyWithBaseVersion(baseVersion: string) {
  return Bun.spawnSync({
    cmd: ["bun", "scripts/verify-release.ts"],
    env: {
      ...Bun.env,
      BASE_VERSION: baseVersion,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

describe("release version gate", () => {
  test("accepts a greater synchronized version", () => {
    const result = verifyWithBaseVersion("0.0.0");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(
      `Verified synchronized release version ${currentVersion}.`,
    );
  });

  test("rejects an unchanged version", () => {
    const result = verifyWithBaseVersion(currentVersion);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Workspace version must increase on every push");
  });
});
