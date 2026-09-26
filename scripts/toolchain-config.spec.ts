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
 * That is how `bun run --filter @aponiajs/cli test`, the narrower command the
 * root guide documents, spent a while failing while the same tests passed from
 * the repository root. Declaring both options in every package makes the outcome
 * independent of the directory a command is started from, which is the property
 * worth holding — no package needs them today except the two whose fixtures boot
 * decorated applications, but nothing marks which package that will be next.
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
});
