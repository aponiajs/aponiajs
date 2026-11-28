# MCP

An application that serves a Model Context Protocol endpoint from
`@aponiajs/mcp`. The tools are methods of a provider, decorated with
`@Tool()`, and the module discovers them when the endpoint mounts.

## Run

```bash
bun run example:mcp
```

The application listens on `PORT`, defaulting to `3200`, and the endpoint
answers on `/mcp`.

```ts
@Injectable()
export class OrdersTools {
  @Tool({ inputSchema: z.object({ a: z.number(), b: z.number() }) })
  add({ a, b }: { a: number; b: number }, _context: McpContext): string {
    return String(a + b);
  }
}
```

`ApiKeyGuard` runs before every tool call. It reads `MCP_TOKEN`, which defaults
to `aponia-example-token`.

## Test

```bash
bun test ../../examples/mcp/test/*.e2e-spec.ts
```

The suite asserts the initialize handshake, `tools/list`, a tool call with
validated arguments, an injected provider, a guard refusal, and the default
Origin refusal.
