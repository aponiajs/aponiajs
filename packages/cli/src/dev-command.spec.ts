import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseArguments } from "./commands/arguments.ts";
import { devCommand, runDevServer } from "./commands/dev-server.ts";

describe("aponia dev", () => {
  test("defaults to src/main.ts", () => {
    expect(parseArguments(["dev"])).toEqual({ command: "dev", entry: "src/main.ts" });
  });

  test("accepts a positional entry or the --entry option", () => {
    expect(parseArguments(["dev", "server.ts"])).toEqual({
      command: "dev",
      entry: "server.ts",
    });
    expect(parseArguments(["dev", "--entry", "app/main.ts"])).toEqual({
      command: "dev",
      entry: "app/main.ts",
    });
  });

  test("rejects a second entrypoint", () => {
    expect(() => parseArguments(["dev", "a.ts", "b.ts"])).toThrow('Unexpected argument "b.ts".');
  });

  test("runs Bun's watcher over the entrypoint", () => {
    expect(devCommand("src/main.ts")).toEqual(["bun", "--watch", "src/main.ts"]);
  });

  test("supports --no-update-check and rejects attached values", () => {
    expect(parseArguments(["dev", "--no-update-check"])).toEqual({
      command: "dev",
      entry: "src/main.ts",
      updateCheck: false,
    });
    expect(() => parseArguments(["dev", "--no-update-check=true"])).toThrow();
  });

  test("runDevServer spawns bun --watch and respects updateCheck: false", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-dev-run-"));
    const prevCi = process.env.CI;
    delete process.env.CI;
    try {
      const entry = join(dir, "missing-entry.ts");
      writeFileSync(entry, "process.exit(0);\n");
      const code = await runDevServer(entry, { updateCheck: false });
      expect(typeof code).toBe("number");

      const codeWithCheck = await runDevServer(entry, {
        checkUpdates: async () => ({
          checkedAt: Date.now(),
          updates: [
            { packageName: "@aponiajs/cli", currentVersion: "1.0.0", latestVersion: "1.1.0" },
          ],
          advisories: [],
        }),
      });
      expect(typeof codeWithCheck).toBe("number");
    } finally {
      if (prevCi !== undefined) process.env.CI = prevCi;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
