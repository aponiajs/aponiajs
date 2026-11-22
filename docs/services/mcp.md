# Model Context Protocol (MCP)

Serve a Model Context Protocol endpoint from an Aponia application. This page
covers the `@aponiajs/mcp` module, the policy it validates, and the two transport
modes. It leaves the protocol itself to the
[official SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk), which is
the only MCP implementation the framework ships.

## The package

`@aponiajs/mcp` is a thin adapter. The SDK owns the handshake, version
negotiation, tool and resource listing, JSON-RPC errors, and the streamable HTTP
transport. The package contributes:

- a `DynamicModule` the endpoint is declared in;
- a validated configuration for the path, the Origin allowlist, and whether the
  endpoint may run unauthenticated;
- a request gate that refuses a disallowed Origin, answers `OPTIONS`, and asks
  the application's `authorize` callback;
- cleanup: a stateless request closes its server when the body ends, and a
  stateful session closes when the client deletes it or the application closes.

Devtools no longer embeds an MCP server, and the CLI no longer starts one. The
package is the whole surface.

## Use it

```ts
import { Module, defineConfiguration } from "@aponiajs/common";
import { McpModule } from "@aponiajs/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const McpConfig = defineConfiguration(
  z.object({
    path: z.string().default("/mcp"),
    allowedOrigins: z.array(z.string()).default([]),
    allowUnauthenticated: z.boolean().default(false),
  }),
  "mcp.config",
);

const token = Bun.env.MCP_TOKEN ?? "";

const mcp = McpModule.register({
  configuration: McpConfig,
  useFactory: () => () => {
    const server = new McpServer({ name: "my-app", version: "1.0.0" });
    server.registerTool(
      "ping",
      { description: "Ping the application", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: "pong" }] }),
    );
    return server;
  },
  authorize: (request) => request.headers.get("authorization") === `Bearer ${token}`,
});

@Module({ imports: [mcp] })
export class AppModule {}
```

The factory returns a server factory. Stateless mode calls it once per request
and stateful mode once per session, because an SDK server connects to exactly
one transport.

## The policy

| Field                  | Default | Contract                                                  |
| ---------------------- | ------- | --------------------------------------------------------- |
| `path`                 | `/mcp`  | An absolute path                                          |
| `allowedOrigins`       | `[]`    | Exact origin strings; empty refuses every browser request |
| `allowUnauthenticated` | `false` | Required when the registration carries no `authorize`     |

The module guards the values after the schema validates them, because a
configuration transform is arbitrary JavaScript. A relative path, an origin list
that is not non-empty strings, or a registration with no authentication path
throws `AponiaError` with code `INVALID_CONFIGURATION_VALUE` and an `issues`
list naming every field to fix.

## Authentication and origins

`authorize` runs before the transport. A `false` answer or a thrown error is a
`401` with `WWW-Authenticate: Bearer`. A request carrying an `Origin` the policy
does not name is a `403` before `authorize` runs, and `OPTIONS` is answered with
`204` and the cross-origin headers a browser client needs.

The endpoint dispatches tools. Keep it behind `authorize`, or set
`allowUnauthenticated: true` deliberately and reach it only on a network that is
already authenticated.

## Stateless and stateful

`sessions` defaults to `"stateless"`. Each request builds a server and a
transport, and both close when the response body ends or the client cancels.
No state survives the request, which is the shape a serverless host needs.

`sessions: "stateful"` keeps one transport per `mcp-session-id`. A `DELETE`
ends the session, a request naming an unknown id is a `404`, and
`application.close()` closes every transport the boot still holds. The store is
in memory, so stateful mode is one instance.

`jsonResponse: true` asks for JSON bodies instead of Server-Sent Events. The SDK
default is `false`, and a client must still send `Accept: application/json,
text/event-stream`.

## Failure behavior

| Answer | Meaning                                                      |
| ------ | ------------------------------------------------------------ |
| `401`  | `authorize` returned false or threw                          |
| `403`  | The request carried an Origin the policy does not allow      |
| `404`  | A stateful request named a session id the boot does not hold |
| `405`  | The transport does not serve the method                      |
| `406`  | The client did not accept both JSON and event streams        |
| `413`  | The body exceeded the transport's bound                      |
| `415`  | The request body was not `application/json`                  |

An invalid configuration fails the boot with `INVALID_CONFIGURATION_VALUE`
before a socket exists.

## Verification

```bash
bun test packages/mcp/tests/mcp-module.test.ts
bun test examples/mcp/test/mcp.e2e-spec.ts
bun run check
```

[Package README](../../packages/mcp/README.md) ·
[Package catalog](../reference/packages.md) ·
[Authoring a plugin package](../tooling/plugin-packages.md)
