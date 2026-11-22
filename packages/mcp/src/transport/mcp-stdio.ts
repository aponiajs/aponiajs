import { AponiaError } from "@aponiajs/common";
import type { Transport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer, readMcpRuntime } from "./mcp-runtime.ts";

/** Options the stdio entry accepts. */
export interface McpStdioServerOptions {
  /** How a 2025-era opening is answered; defaults to the module's policy. */
  readonly legacy?: "serve" | "reject";
  /** A transport to own instead of the process's stdin and stdout. */
  readonly transport?: Transport;
}

/**
 * Serves the application's MCP primitives over stdio.
 *
 * The application must have been booted with `McpModule`; its mount attaches
 * the discovery plan this entry reads. The returned handle closes the pinned
 * SDK instance and the transport.
 *
 * @param application - The booted Aponia application.
 * @param options - The legacy-era policy.
 * @returns The SDK handle for the connection.
 */
export function serveMcpStdio(
  application: object,
  options: McpStdioServerOptions = {},
): ReturnType<typeof serveStdio> {
  const runtime = readMcpRuntime(application);
  if (runtime === undefined) {
    throw new AponiaError(
      "INVALID_MCP_OPTIONS",
      "The application was not booted with McpModule, so it holds no MCP primitives.",
    );
  }

  return serveStdio(
    (requestContext) =>
      buildServer(runtime.plan, runtime.container, runtime.options, requestContext),
    {
      legacy: options.legacy ?? runtime.options.stdioLegacy,
      ...(options.transport === undefined ? {} : { transport: options.transport }),
    },
  );
}

/**
 * Serves stdio until the client closes stdin, then closes the connection.
 *
 * @param application - The booted Aponia application.
 * @param options - The legacy-era policy.
 * @returns A promise that resolves when the client disconnects.
 */
export async function listenMcpStdio(
  application: object,
  options: McpStdioServerOptions = {},
): Promise<void> {
  const handle = serveMcpStdio(application, options);

  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      process.stdin.once("end", finish);
      process.stdin.once("close", finish);
    });
  } finally {
    await handle.close();
  }
}
