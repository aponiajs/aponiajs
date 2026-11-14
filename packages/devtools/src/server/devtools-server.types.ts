/**
 * One endpoint: a `Request` in, a `Response` out.
 *
 * A handler may answer a promise, because an endpoint that loads an analyzer on
 * its first request answers one. The dispatcher hands whatever the handler
 * returned straight back, so the promise is the second half of this type rather
 * than something every handler has to await.
 */
export type DevtoolsRequestHandler = (
  request: Request,
  body?: unknown,
) => Response | Promise<Response>;

/**
 * The endpoints one surface serves, keyed by the path suffix after the devtools
 * prefix — `/meta`, not `/__devtools/meta` — because the prefix belongs to the
 * dispatcher and the suffix belongs to the endpoint that claims it.
 */
export type DevtoolsHandlers = Readonly<Record<string, DevtoolsRequestHandler>>;
