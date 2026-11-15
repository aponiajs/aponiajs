import type { ServerlessApplication } from "../lambda/lambda.types.ts";

/** A Web Fetch handler: one `Request`, one `Response`. */
export type FetchHandler = (request: Request) => Promise<Response>;

/**
 * Adapts an Aponia application to the Web Fetch handler shape a worker runtime
 * or edge platform expects.
 *
 * The application already answers `Request` with `Response`; this normalizes
 * the return to a Promise and binds the application, so the result can be
 * exported directly as `{ fetch: handler }`.
 *
 * @param application - The application whose `handle` answers each request.
 * @returns A handler that resolves the application's response.
 */
export function toFetchHandler(application: ServerlessApplication): FetchHandler {
  // An async wrapper turns a synchronous throw from `handle` into a rejected
  // promise, which is what a Fetch runtime expects from a handler.
  return async (request) => application.handle(request);
}
