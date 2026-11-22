import { resolve } from "node:path";
import type { StartCommandOptions } from "./command.types.ts";

/**
 * Runs one application entrypoint without opening a server of its own.
 *
 * @param options - The entry, watcher, inspector, and production switches.
 * @returns The exit code Bun reported.
 */
export async function runStartCommand(options: StartCommandOptions): Promise<number> {
  const root = resolve(options.cwd ?? process.cwd());
  const configuration = (await readConfiguration(root)) ?? {};
  const entryFile =
    options.entry ??
    (typeof configuration.entryFile === "string" ? configuration.entryFile : "main");
  const file = options.path ?? (options.prod ? `dist/${entryFile}.js` : `src/${entryFile}.ts`);
  const arguments_: string[] = ["bun"];

  if (options.watch) {
    arguments_.push("--watch");
  }
  if (options.debug) {
    arguments_.push("--inspect");
  }
  arguments_.push(file);

  const child = Bun.spawn(arguments_, {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return await child.exited;
}

async function readConfiguration(root: string): Promise<Record<string, unknown> | undefined> {
  const file = Bun.file(resolve(root, "aponia.json"));
  if (!(await file.exists())) {
    return undefined;
  }
  return (await file.json()) as Record<string, unknown>;
}
