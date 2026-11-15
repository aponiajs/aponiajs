import { describe, expect, test } from "bun:test";
import { parseArguments } from "../src/commands/arguments.ts";
import { devCommand } from "../src/commands/dev-server.ts";

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
});
