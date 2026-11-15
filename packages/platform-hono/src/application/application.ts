import {
  AponiaHttpApplication,
  createPlatformFactory,
  type AponiaHttpApplicationOptions,
} from "@aponiajs/platform-core";
import type { AponiaRootModule } from "@aponiajs/platform-core";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { createHonoHost, type HonoApplication } from "../host/hono-host.ts";

const factory = createPlatformFactory<HonoApplication>(createHonoHost());

/** The managed application this platform returns. */
export type HonoAponiaApplication = AponiaHttpApplication<HonoApplication>;

/**
 * Boots an Aponia application onto Hono.
 *
 * The returned wrapper answers through the Hono application it created, so
 * middleware registered on it before the boot's dispatcher — none, when the
 * platform creates the application itself — runs first.
 */
export const AponiaFactory = {
  /** Boots the graph and returns the managed application. */
  async create(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions = {},
  ): Promise<HonoAponiaApplication> {
    return await factory.create(rootModule, options);
  },

  /** Boots the graph and returns the native Hono instance. */
  async createNative(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions = {},
  ): Promise<Hono> {
    return await factory.createNative(rootModule, options);
  },
} as const;

/**
 * A Hono middleware that answers the requests the application has a route for
 * and lets every other request continue.
 *
 * Mount it after the middleware that has to run first:
 *
 * ```ts
 * const application = await AponiaFactory.create(AppModule);
 * const app = new Hono();
 * app.use("*", logger());
 * app.use("*", toHonoPlatformHandler(application));
 * ```
 *
 * @param application - The booted application.
 * @returns The middleware.
 */
export function toHonoPlatformHandler(
  application: AponiaHttpApplication<HonoApplication>,
): MiddlewareHandler {
  return async (context: Context, next) => {
    const response = await application.tryHandle(context.req.raw, {
      path: context.req.path,
      native: context,
    });
    if (response !== undefined) {
      return response;
    }
    await next();
  };
}
