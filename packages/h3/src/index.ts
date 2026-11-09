import { fromWebHandler } from "h3";
import type { EventHandler } from "h3";
import { toFetchHandler } from "@aponiajs/serverless";
import type { ServerlessApplication } from "@aponiajs/serverless";

/**
 * Adapts an Aponia application to an H3 event handler.
 *
 * H3 owns the event envelope; the application answers the Fetch request H3
 * derives from it. Mount the result with app.use() or as a route handler.
 */
export function toH3Handler(application: ServerlessApplication): EventHandler {
  return fromWebHandler(toFetchHandler(application));
}
