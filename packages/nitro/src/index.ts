import { defineHandler } from "nitro";
import type { EventHandlerWithFetch } from "nitro";
import { toFetchHandler } from "@aponiajs/serverless";
import type { ServerlessApplication } from "@aponiajs/serverless";

/**
 * Adapts an Aponia application to a Nitro server route handler.
 *
 * Export the result from a Nitro server route such as
 * server/routes/[...all].ts. Nitro owns the route table and deployment
 * envelope; the application answers the Fetch request Nitro forwards.
 */
export function toNitroHandler(application: ServerlessApplication): EventHandlerWithFetch {
  return defineHandler({ fetch: toFetchHandler(application) });
}

/** Alias that states the intended Nitro server-route usage. */
export const defineAponiaHandler = toNitroHandler;
