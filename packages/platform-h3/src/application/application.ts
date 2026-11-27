import type { AponiaHttpApplicationOptions, AponiaRootModule } from "@aponiajs/common";
import { AponiaHttpApplication, createBootstrapFactory } from "./bootstrap.ts";
import type { H3Event, Middleware } from "h3";
import { createH3Host, type H3Application } from "../host/h3-host.ts";

const factory = createBootstrapFactory<H3Application>(createH3Host());

/** The managed application this platform returns. */
export type H3AponiaApplication = AponiaHttpApplication<H3Application>;

/** Boots an Aponia application onto H3. */
export const AponiaFactory = {
  /** Boots the graph and returns the managed application. */
  async create(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions = {},
  ): Promise<H3AponiaApplication> {
    return await factory.create(rootModule, options);
  },

  /** Boots the graph and returns the native H3 instance. */
  async createNative(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions = {},
  ): Promise<H3Application> {
    return await factory.createNative(rootModule, options);
  },
} as const;

/**
 * An H3 middleware that answers the requests the application has a route for
 * and lets every other request continue.
 *
 * @param application - The booted application.
 * @returns The middleware.
 */
export function toH3PlatformHandler(application: AponiaHttpApplication<H3Application>): Middleware {
  return async (event: H3Event, next) => {
    const response = await application.tryHandle(event.req as Request, {
      path: event.url.pathname,
      native: event,
    });
    if (response !== undefined) {
      return response;
    }
    await next();
  };
}
