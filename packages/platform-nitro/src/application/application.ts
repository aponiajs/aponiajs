import {
  createPlatformFactory,
  type AponiaHttpApplication,
  type AponiaHttpApplicationOptions,
  type AponiaRootModule,
} from "@aponiajs/platform-core";
import type { H3Application } from "@aponiajs/platform-h3";
import { defineHandler, type EventHandlerWithFetch } from "nitro";
import { createNitroHost } from "../host/nitro-host.ts";

const factory = createPlatformFactory<H3Application>(createNitroHost());

/** The managed application this platform returns. */
export type NitroAponiaApplication = AponiaHttpApplication<H3Application>;

/** Boots an Aponia application for Nitro to serve. */
export const AponiaFactory = {
  /** Boots the graph and returns the managed application. */
  async create(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions = {},
  ): Promise<NitroAponiaApplication> {
    return await factory.create(rootModule, options);
  },

  /** Boots the graph and returns the H3 application Nitro serves. */
  async createNative(
    rootModule: AponiaRootModule,
    options: AponiaHttpApplicationOptions = {},
  ): Promise<H3Application> {
    return await factory.createNative(rootModule, options);
  },
} as const;

/**
 * A Nitro server handler over a booted application.
 *
 * Export it from `server/routes/[...all].ts`; Nitro owns the server, so the
 * application never listens.
 *
 * @param application - The booted application.
 * @returns The handler Nitro invokes.
 */
export function createAponiaNitroHandler(
  application: AponiaHttpApplication<H3Application>,
): EventHandlerWithFetch {
  return defineHandler({ fetch: (request) => application.handle(request) });
}
