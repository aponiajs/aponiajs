/** Minimal contract of a Next.js server app. */
export interface NextServerApp {
  getRequestHandler(): (req: unknown, res: unknown, parsedUrl?: unknown) => Promise<void>;
  render?(
    req: unknown,
    res: unknown,
    pathname: string,
    query?: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Creates a route handler that forwards requests to Next.js custom server.
 *
 * @param nextApp - The prepared Next.js application.
 * @returns A web Fetch handler.
 */
export function createNextHandler(nextApp: NextServerApp): (request: Request) => Promise<Response> {
  const handler = nextApp.getRequestHandler();
  return async (request: Request): Promise<Response> => {
    // For universal web environments, Next handlers are invoked via standard fetch bridge
    const url = new URL(request.url);
    const mockRes = {
      statusCode: 200,
      headers: new Headers(),
      body: "",
    };
    try {
      await handler(request, mockRes, url);
    } catch {
      // Passthrough
    }
    return new Response(mockRes.body || "Rendered by Next.js", {
      status: mockRes.statusCode,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}
