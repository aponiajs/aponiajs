import type { LoggerService } from "@aponiajs/common";
import type { Elysia } from "elysia";

/** The loopback HTTP surface one devtools boot publishes. */
export interface DevtoolsServer {
  /** The origin the socket bound, for example `http://127.0.0.1:51234`. */
  readonly url: string;
  /** Stops the socket, waiting for the requests already in flight. */
  stop(): void;
}

/** What starting one devtools server needs to know. */
export interface DevtoolsServerOptions {
  /**
   * The native application the report describes. It is read through
   * `readApplicationDiagnostics`, so an application no boot produced is
   * reported as one rather than refused.
   */
  readonly application: Elysia;
  /** The loopback port to bind. Defaults to the devtools default port. */
  readonly port?: number;
  /** Where a refused bind is reported, so a boot cannot swallow the reason. */
  readonly logger: LoggerService;
}

/**
 * One endpoint: a `Request` in, a `Response` out.
 *
 * A handler may answer a promise, because an endpoint that loads an analyzer on
 * its first request answers one. The dispatcher hands whatever the handler
 * returned straight back, so the promise is the second half of this type rather
 * than something every handler has to await.
 */
export type DevtoolsRequestHandler = (request: Request) => Response | Promise<Response>;

/**
 * The endpoints one server serves, keyed by the path suffix after the devtools
 * prefix — `/meta`, not `/__devtools/meta` — because the prefix belongs to the
 * dispatcher and the suffix belongs to the endpoint that claims it.
 */
export type DevtoolsHandlers = Readonly<Record<string, DevtoolsRequestHandler>>;
