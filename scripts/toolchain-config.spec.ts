import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Bun chooses the transpiler configuration from the **process working
 * directory**, not from the file being run. A package whose `tsconfig.json`
 * omits the decorator options therefore does not fail loudly when a command runs
 * from that directory: decorators are transpiled with stage-3 semantics, method
 * decorator metadata lands on the wrong receiver, `design:paramtypes` is never
 * emitted, and a decorated controller ends up with an empty route plan. The
 * application answers `404` and nothing is thrown.
 *
 * That is how the package-scoped lane the root guide documents spent a while
 * failing while the same tests passed from the repository root. Declaring both
 * options in every package makes the outcome independent of the directory a
 * command is started from, which is the property worth holding.
 *
 * This guard checks the configuration rather than the symptom: proving the
 * behaviour needs a decorated application booted from each package directory,
 * which is what the package lanes themselves do.
 */
describe("toolchain configuration", () => {
  test("declares the decorator transpiler options in every package tsconfig", async () => {
    const directories = (await readdir("packages", { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();

    expect(directories.length).toBeGreaterThan(0);

    for (const name of directories) {
      const path = join("packages", name, "tsconfig.json");
      const manifest = (await Bun.file(path).json()) as {
        compilerOptions?: Readonly<Record<string, unknown>>;
      };

      expect(manifest.compilerOptions?.experimentalDecorators, `${path}`).toBe(true);
      expect(manifest.compilerOptions?.emitDecoratorMetadata, `${path}`).toBe(true);
    }
  });

  /**
   * The Bun version is pinned in five places that nothing kept in step: the
   * `packageManager` field, the `devEngines` requirement beside it, `mise.toml`
   * for a local checkout, `bun-version` in every workflow, and the README badge.
   * A version that drifts between them is invisible until CI fails on a tree
   * that passes locally, or a contributor reproduces a bug on a release the
   * maintainer never ran.
   *
   * `packageManager` is the source of truth because it is the field the
   * ecosystem reads; everything else is asserted against it.
   */
  test("pins one Bun version across the toolchain and CI", async () => {
    const rootManifest = (await Bun.file("package.json").json()) as {
      readonly packageManager?: string;
      readonly devEngines?: { readonly packageManager?: { readonly version?: string } };
    };
    const declared = rootManifest.packageManager?.replace(/^bun@/, "");
    if (declared === undefined) {
      throw new Error("package.json must declare packageManager as bun@<version>.");
    }
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rootManifest.devEngines?.packageManager?.version, "package.json devEngines").toBe(
      declared,
    );

    const mise = await Bun.file("mise.toml").text();
    expect(/bun\s*=\s*"([^"]+)"/.exec(mise)?.[1], "mise.toml").toBe(declared);

    const starter = (await Bun.file("packages/cli/templates/application/package.json").json()) as {
      readonly packageManager?: string;
    };
    expect(starter.packageManager, "starter packageManager").toBe(`bun@${declared}`);

    const workflowNames = (await readdir(".github/workflows")).filter((name) =>
      name.endsWith(".yml"),
    );
    let pins = 0;
    for (const name of workflowNames) {
      const path = join(".github/workflows", name);
      for (const match of (await Bun.file(path).text()).matchAll(/bun-version:\s*(\S+)/g)) {
        pins += 1;
        // Paired with the path so a failure names the workflow that drifted.
        expect([path, match[1]]).toEqual([path, declared]);
      }
    }

    // A workflow that stopped pinning Bun altogether would satisfy every
    // assertion above while letting CI float to whatever `setup-bun` defaults
    // to, which is the drift this test exists to catch.
    expect(pins, "workflow bun-version pins").toBeGreaterThan(0);

    expect(await Bun.file("README.md").text(), "README badge").toContain(`badge/Bun-${declared}-`);
  });
});
