import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSupportedBuilder,
  loadCliConfiguration,
  mergeConfiguration,
  resetConfigurationWarnings,
  resolveBuilder,
} from "./cli-configuration.ts";
import { upgradeAponiaPackages } from "./upgrade-generator.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  resetConfigurationWarnings();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aponia-cli-config-"));
  temporaryDirectories.push(root);
  return root;
}

describe("the CLI configuration", () => {
  test("reads the defaults when no file exists", async () => {
    const root = await project();
    const loaded = await loadCliConfiguration(root);
    expect(loaded.source).toBe("defaults");
    expect(loaded.configuration.collection).toBe("@aponiajs/schematics");
  });

  test("refuses an unknown language, an unknown builder, and the deprecated webpack flag", () => {
    expect(() => mergeConfiguration({ language: "coffee" }, "aponia-cli.json")).toThrow(
      'Unrecognized language "coffee" in aponia-cli.json. Use "ts" or "js".',
    );
    expect(() =>
      mergeConfiguration({ compilerOptions: { builder: "esbuild" } }, "aponia-cli.json"),
    ).toThrow('Unknown builder "esbuild". Use "tsc" or "swc".');
    expect(() =>
      mergeConfiguration({ compilerOptions: { webpack: true } }, "aponia-cli.json"),
    ).toThrow('The "webpack" builder is not supported by the Aponia CLI.');
  });

  test("resolves the supported builders", () => {
    expect(resolveBuilder({})).toBe("tsc");
    expect(resolveBuilder({ builder: "swc" })).toBe("swc");
    expect(resolveBuilder({ builder: { type: "swc" } })).toBe("swc");
    expect(() => assertSupportedBuilder({ builder: { type: "rspack" } })).toThrow(
      'The "rspack" builder is not supported by the Aponia CLI.',
    );
  });

  test("rejects a JSON document that is not an object", async () => {
    const root = await project();
    await Bun.write(join(root, "aponia-cli.json"), "[]");
    expect(loadCliConfiguration(root)).rejects.toThrow(
      'Could not parse "aponia-cli.json". Ensure it contains valid JSON.',
    );
  });
});

describe("the upgrade generator", () => {
  test("refuses a missing manifest and a tag that disagrees with the release", async () => {
    const root = await project();
    const options = {
      command: "generate" as const,
      schematic: "upgrade" as const,
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest" as const,
      cwd: root,
    };
    expect(upgradeAponiaPackages(root, options)).rejects.toThrow(
      `Could not find "package.json" in "${root}".`,
    );

    await Bun.write(join(root, "package.json"), JSON.stringify({ name: "sample" }));
    expect(upgradeAponiaPackages(root, { ...options, tag: "latest" })).rejects.toThrow(
      "does not match this release.",
    );
  });

  test("runs the package manager after a successful rewrite and reports its failure", async () => {
    const root = await project();
    await Bun.write(
      join(root, "package.json"),
      JSON.stringify({ name: "sample", dependencies: { "@aponiajs/common": "0.0.1" } }),
    );
    const options = {
      command: "generate" as const,
      schematic: "upgrade" as const,
      dryRun: false,
      skipImport: false,
      crud: false,
      type: "rest" as const,
      cwd: root,
    };

    const success = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(0),
    } as ReturnType<typeof Bun.spawn>);
    try {
      await upgradeAponiaPackages(root, options);
      expect(success).toHaveBeenCalledTimes(1);
    } finally {
      success.mockRestore();
    }

    const failure = spyOn(Bun, "spawn").mockReturnValue({
      exited: Promise.resolve(1),
    } as ReturnType<typeof Bun.spawn>);
    try {
      expect(upgradeAponiaPackages(root, options)).rejects.toThrow(
        "The package manager failed after upgrading the Aponia packages.",
      );
    } finally {
      failure.mockRestore();
    }
  });
});
