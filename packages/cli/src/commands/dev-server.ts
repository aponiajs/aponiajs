import type { UpdateCheckReport } from "../interfaces/update-notifier.interface.ts";
import { checkForUpdatesAndAdvisories, formatUpdateAdvisoryBanner } from "./update-notifier.ts";

/**
 * The argv `aponia dev` runs: Bun's watcher over the application entrypoint.
 *
 * @param entry - The entrypoint file, relative to the working directory.
 * @returns The command and its arguments.
 *
 * @internal
 */
export function devCommand(entry: string): readonly string[] {
  return ["bun", "--watch", entry];
}

/** Options for {@link runDevServer}. */
export interface RunDevServerOptions {
  readonly updateCheck?: boolean;
  readonly checkUpdates?: () => Promise<UpdateCheckReport | undefined>;
}

/**
 * Runs the entrypoint under Bun's watcher until it exits, while running a
 * non-blocking update and dangerous-patch advisory check in parallel.
 *
 * The child inherits the terminal, so the watcher's reload output and the
 * stop signal reach the streams the CLI was started with. The returned code is
 * the watcher's own.
 *
 * @param entry - The entrypoint file, relative to the working directory.
 * @param options - Optional dev server options.
 * @returns The child's exit code.
 *
 * @internal
 */
export async function runDevServer(
  entry: string,
  options: RunDevServerOptions = {},
): Promise<number> {
  const skipCheck =
    options.updateCheck === false ||
    process.env.CI === "true" ||
    process.env.APONIA_NO_UPDATE_CHECK === "1";

  const checkFn = options.checkUpdates ?? checkForUpdatesAndAdvisories;
  const checkPromise = skipCheck
    ? undefined
    : checkFn().then((report) => {
        if (report === undefined) {
          return;
        }
        const banner = formatUpdateAdvisoryBanner(report);
        if (banner !== undefined) {
          console.warn(banner);
        }
      });

  const child = Bun.spawn([...devCommand(entry)], {
    stdio: ["inherit", "inherit", "inherit"],
  });

  const code = await child.exited;
  await checkPromise;
  return code;
}
