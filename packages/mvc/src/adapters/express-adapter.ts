import { toFetchHandler, type ServerlessApplication } from "@aponiajs/serverless";

/**
 * Adapts an AponiaJS application to Express / Connect middleware.
 *
 * @param application - The Aponia application.
 * @returns Express middleware function (req, res, next).
 */
export function toExpressHandler(
  application: ServerlessApplication,
): (req: unknown, res: unknown, next?: (err?: unknown) => void) => Promise<void> {
  const fetchHandler = toFetchHandler(application);

  return async (req: unknown, res: unknown, next?: (err?: unknown) => void): Promise<void> => {
    const expressReq = req as {
      url: string;
      method: string;
      headers: Record<string, string>;
      rawBody?: Buffer | string;
    };
    const expressRes = res as {
      status(code: number): unknown;
      set(headers: Record<string, string>): unknown;
      send(body: unknown): unknown;
    };

    try {
      const url = `http://${expressReq.headers.host ?? "localhost"}${expressReq.url}`;
      const request = new Request(url, {
        method: expressReq.method,
        headers: expressReq.headers,
        body: ["GET", "HEAD"].includes(expressReq.method) ? undefined : expressReq.rawBody,
      });

      const response = await fetchHandler(request);
      expressRes.status(response.status);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      expressRes.set(headers);

      const bodyText = await response.text();
      expressRes.send(bodyText);
    } catch (error) {
      if (typeof next === "function") {
        next(error);
      }
    }
  };
}
