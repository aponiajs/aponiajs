# MCP

An application that serves a Model Context Protocol endpoint from the
`@aponiajs/mcp` package. The tools are built on the official
`@modelcontextprotocol/sdk` server; the package contributes the module
registration, the validated policy, and the request gate.

## Run

```bash
bun run example:mcp
```

The application listens on `PORT`, defaulting to `3200`, and the endpoint
answers on `MCP_PATH`, defaulting to `/mcp`.

| Variable                    | Meaning                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `MCP_TOKEN`                 | The bearer token a client sends; defaults to `aponia-example-token`  |
| `MCP_PATH`                  | The endpoint path                                                    |
| `MCP_ALLOWED_ORIGINS`       | Comma-separated browser origins; empty refuses every browser request |
| `MCP_ALLOW_UNAUTHENTICATED` | Set to `true` to answer without a token                              |

The registration reads the policy from `src/config.ts`, builds one server per
request through `src/mcp-server.ts`, and closes it when the response body ends.
`authorize` is the token check; a false answer is a `401`.

## Test

```bash
bun test ../../examples/mcp/test/*.e2e-spec.ts
```

The suite boots the application with a controlled environment, then asserts the
401 without a token, the initialize handshake, `tools/list`, `tools/call`, a
configured path, and the Origin refusal.
