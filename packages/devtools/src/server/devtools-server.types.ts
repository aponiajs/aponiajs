import type { LoggerService } from "@aponiajs/common";
import type { Elysia } from "elysia";
import type { LogBuffer } from "../logging/log-buffer.types.ts";
import type { RequestBuffer } from "../requests/request-buffer.types.ts";

/** The HTTP surface one devtools boot publishes. */
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
  /** The port to bind. Defaults to the devtools default port. */
  readonly port?: number;
  /**
   * The address to bind. Defaults to the devtools default host, which is
   * loopback; a host outside loopback is permitted and reported once, because
   * `/requests` records request headers and bodies by default.
   */
  readonly host?: string;
  /** Where a refused bind and an exposed bind are reported. */
  readonly logger: LoggerService;
  /**
   * The application's log stream, when the caller has one to publish.
   *
   * It is the caller's rather than the server's because a stream has to start
   * before the server does: `LoggerService` is the object the application and the
   * platform both write to, so whoever holds it is who can record what a boot
   * wrote before `onStart` ran — which is the registration, not this function. A
   * server that is handed none serves no `/logs` at all, because that endpoint
   * states a stream and this one has none to state; the dispatcher's `404` is the
   * answer for a path the handler record does not own.
   */
  readonly logs?: LogBuffer;
  /**
   * The application's request record, when the caller has one to publish.
   *
   * Like the log stream, it is the caller's, because the object has to be the one
   * the other half of the pair holds: the capture's hooks fill the buffer the
   * boot opened, so the object the hooks write and the object this server reads
   * have to be the same one, and the boot is what opened it. A server handed none
   * serves no `/requests` at all, the way one handed no stream serves no `/logs`:
   * the endpoint states a record and this one has none to state.
   */
  readonly requests?: RequestBuffer;
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
