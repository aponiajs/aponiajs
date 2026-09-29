import { resolve } from "node:path";
import type { NativeElysiaConfigurator } from "@aponiajs/platform-elysia";
import type { Elysia } from "elysia";

/**
 * Resolved from this file. Bun reads a directory route's `dir` relative to the
 * process working directory, so `./public` works when the example is started from
 * its own directory and throws `ENOENT` everywhere else.
 */
export const assetsDirectory = resolve(import.meta.dir, "../public");

/**
 * Mounts the assets at `/assets/*` on the native application.
 *
 * The route is registered on `config.serve`, never through `listen`'s options: the
 * Bun adapter builds the routes it passes to `Bun.serve` from the application's own
 * routes merged with `config.serve.routes`, so an option given to `listen` is
 * overwritten. The prefix has to end in `/*`; that is the shape Bun's own route
 * requires.
 */
export const configureStaticAssets: NativeElysiaConfigurator<Elysia> = (native) => {
  const config = native["~config"];
  if (!config) {
    throw new Error("Elysia's Bun serve configuration is unavailable.");
  }
  config.serve = {
    ...config.serve,
    routes: { ...config.serve?.routes, "/assets/*": { dir: assetsDirectory } },
  };
  return native;
};
