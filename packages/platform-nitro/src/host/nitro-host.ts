import { createH3Host, type H3Application } from "@aponiajs/platform-h3";
import type { PlatformHost } from "@aponiajs/platform-core";
import type { H3Event } from "h3";

/**
 * The H3 binding, named for the server that runs it.
 *
 * Nitro serves an H3 application, so the mount, the native fetch, and the
 * request info are H3's; only the name differs, which is what a boot record and
 * a log line report. Nitro owns the server and the process lifecycle, so an
 * application started by Nitro never calls the listener.
 */
export function createNitroHost(): PlatformHost<H3Application, H3Event> {
  return Object.freeze({
    ...createH3Host(),
    name: "nitro",
  });
}
