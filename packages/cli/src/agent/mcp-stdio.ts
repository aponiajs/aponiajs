import type { AgentMcpServer } from "./mcp-protocol.ts";

/** The framing options a stdio server accepts, primarily for tests. */
export interface McpStdioOptions {
  readonly input?: AsyncIterable<Uint8Array>;
  readonly write?: (text: string) => void;
  readonly error?: (text: string) => void;
}

/**
 * Serves one MCP server over newline-delimited JSON-RPC on stdio.
 *
 * stdout carries protocol frames only; diagnostics go to stderr. A malformed
 * line answers a JSON-RPC parse error without ending the session.
 */
export async function serveMcpStdio(
  server: AgentMcpServer,
  options: McpStdioOptions = {},
): Promise<void> {
  const input = options.input ?? Bun.stdin.stream();
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const report = options.error ?? ((text: string) => process.stderr.write(text));
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = async (line: string): Promise<void> => {
    if (line.trim() === "") {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        })}\n`,
      );
      return;
    }

    try {
      const response = await server.handleMessage(message);
      if (response !== null) {
        write(`${JSON.stringify(response)}\n`);
      }
    } catch (error) {
      report(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  };

  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await handleLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  await handleLine(buffer);
}
