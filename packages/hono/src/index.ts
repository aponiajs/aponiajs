import { Hono } from "hono";
import type { Context } from "hono";
import { toFetchHandler } from "@aponiajs/serverless";
import type { ServerlessApplication } from "@aponiajs/serverless";

/** A Hono handler that answers one Aponia request. */
export type HonoHandler = (context: Context) => Promise<Response>;

/**
 * Adapts an Aponia application to a Hono handler.
 *
 * Hono keeps its own middleware and routing in front; the Aponia application
 * answers only the request Hono forwards, through the same handle() a listener
 * uses.
 */
export function toHonoHandler(application: ServerlessApplication): HonoHandler {
  const handle = toFetchHandler(application);
  return async (context) => handle(context.req.raw);
}

/** Creates a Hono app with the Aponia catch-all route mounted. */
export function createHonoApp(application: ServerlessApplication): Hono {
  const applicationHost = new Hono();
  applicationHost.all("*", toHonoHandler(application));
  return applicationHost;
}
