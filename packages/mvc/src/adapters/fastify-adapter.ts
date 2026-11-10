import { toFetchHandler, type ServerlessApplication } from "@aponiajs/serverless";

/**
 * Adapts an AponiaJS application to a Fastify route handler or plugin.
 *
 * @param application - The Aponia application.
 * @returns Fastify route handler.
 */
export function toFastifyHandler(
  application: ServerlessApplication,
): (request: unknown, reply: unknown) => Promise<void> {
  const fetchHandler = toFetchHandler(application);

  return async (request: unknown, reply: unknown): Promise<void> => {
    const fastifyReq = request as {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: unknown;
    };
    const fastifyReply = reply as {
      status(code: number): unknown;
      headers(headers: Record<string, string>): unknown;
      send(payload: unknown): unknown;
    };

    const host = fastifyReq.headers.host ?? "localhost";
    const webRequest = new Request(`http://${host}${fastifyReq.url}`, {
      method: fastifyReq.method,
      headers: fastifyReq.headers,
      body: ["GET", "HEAD"].includes(fastifyReq.method)
        ? undefined
        : JSON.stringify(fastifyReq.body),
    });

    const webResponse = await fetchHandler(webRequest);
    fastifyReply.status(webResponse.status);

    const headers: Record<string, string> = {};
    webResponse.headers.forEach((v, k) => {
      headers[k] = v;
    });
    fastifyReply.headers(headers);

    const body = await webResponse.text();
    fastifyReply.send(body);
  };
}
