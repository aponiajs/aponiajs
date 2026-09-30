import { formatBuildReport } from "../generation/build-report.ts";
import { generateInvokers } from "../generation/invoker-generator.ts";
import type { BuildPluginOptions } from "./aponia-build-plugin.types.ts";

/** The name Bun reports this plugin under in a build error. */
export const buildPluginName = "aponia-build";

/**
 * A Bun plugin that regenerates an application's build artifacts as part of
 * bundling, so a build cannot serve a stale one.
 *
 * An application whose entrypoint imports `<sourceRoot>/invokers.generated.ts`
 * only bundles while that file exists, and only bundles *correctly* while it is
 * current. Running `aponia build` by hand is therefore load-bearing in a way
 * nothing enforces. Registering this plugin moves that step into the build:
 * register it in a script that calls `Bun.build`, and every bundle regenerates
 * the artifacts before the bundler resolves anything.
 *
 * ```ts
 * // scripts/build.ts
 * import { buildPlugin } from "@aponiajs/cli";
 *
 * const result = await Bun.build({
 *   entrypoints: ["./src/main.ts"],
 *   outdir: "./dist",
 *   target: "bun",
 *   plugins: [buildPlugin()],
 * });
 * if (!result.success) process.exit(1);
 * ```
 *
 * Generation runs in `onStart`, which Bun awaits before it resolves the first
 * import. That ordering is the whole point: a hook that runs during resolution
 * or after it cannot help an entrypoint whose import is the file being written.
 *
 * A generation failure rejects the build instead of being reported and skipped.
 * The old artifact is left on disk untouched — generation writes nothing unless
 * it completes — so a build that continued would bundle the previous release's
 * invokers, which is exactly what the artifact's version stamp exists to catch.
 * The error is the generator's own, so it names the declaration that has to
 * change.
 *
 * Registration is opt-in. A build that does not register the plugin behaves
 * exactly as it did before, and `aponia build` remains the way to generate
 * without bundling.
 *
 * The return type is Bun's ambient `Bun.BunPlugin` rather than an imported
 * `BunPlugin`, because `bun-types` declares it in the global `Bun` namespace and
 * declares no matching export from the `"bun"` module. An import survives into
 * this package's emitted declarations, where the declaration bundler cannot
 * resolve it and fails the build.
 */
export function buildPlugin(options: BuildPluginOptions = {}): Bun.BunPlugin {
  return {
    name: buildPluginName,
    setup(build) {
      build.onStart(async () => {
        const result = await generateInvokers({
          cwd: options.cwd,
          dryRun: false,
          project: options.project,
        });
        for (const line of formatBuildReport(result)) {
          console.log(line);
        }
      });
    },
  };
}
