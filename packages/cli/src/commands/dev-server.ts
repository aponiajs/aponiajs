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

/**
 * Runs the entrypoint under Bun's watcher until it exits.
 *
 * The child inherits the terminal, so the watcher's reload output and the
 * stop signal reach the streams the CLI was started with. The returned code is
 * the watcher's own.
 *
 * @param entry - The entrypoint file, relative to the working directory.
 * @returns The child's exit code.
 *
 * @internal
 */
export async function runDevServer(entry: string): Promise<number> {
  const child = Bun.spawn([...devCommand(entry)], {
    stdio: ["inherit", "inherit", "inherit"],
  });

  return await child.exited;
}
