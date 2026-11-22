# @aponiajs/mcp

```bash
bun add @aponiajs/mcp @modelcontextprotocol/sdk zod
```

Serve a Model Context Protocol endpoint from an Aponia application.

The package is a thin adapter over
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).
Every JSON-RPC frame, handshake version, tool listing, resource read, and
streamable HTTP exchange is the SDK's. AponiaJS contributes a module the
endpoint is declared in, a validated policy read from a configuration, the
request gate, and the lifecycle that closes sessions when the application
closes.

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
      "add",
      { description: "Add two numbers", inputSchema: { a: z.number(), b: z.number() } },
      async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
    );
    return server;
  },
  authorize: (request) => request.headers.get("authorization") === `Bearer ${token}`,
});

@Module({ imports: [mcp] })
export class AppModule {}
```

The factory returns a server factory rather than a server. Stateless mode calls
it once per request and stateful mode once per session, because an SDK server
connects to exactly one transport.

## The validated configuration

The policy arrives through a `defineConfiguration` token, so a value the schema
refuses fails the boot before a socket exists:

| Field                  | Default | Contract                                                  |
| ---------------------- | ------- | --------------------------------------------------------- |
| `path`                 | `/mcp`  | An absolute path                                          |
| `allowedOrigins`       | `[]`    | Exact origin strings; empty refuses every browser request |
| `allowUnauthenticated` | `false` | Required when the registration carries no `authorize`     |

The module guards the value again after the schema, because a configuration
transform is arbitrary JavaScript. A relative path, an origin list that is not
non-empty strings, or a registration with no authentication path throws an
`AponiaError` with code `INVALID_CONFIGURATION_VALUE` and an `issues` list.

## Authentication and origins

`authorize` is the authentication decision. A `false` answer or a thrown error
is a `401` with `WWW-Authenticate: Bearer`. A request that carries an `Origin`
not named in `allowedOrigins` is a `403`, answered before `authorize` runs.
`OPTIONS` is answered with `204` and the cross-origin headers a browser client
needs, without reaching the transport.

The endpoint is a tool-dispatch surface. Keep it behind `authorize`, or set
`allowUnauthenticated: true` deliberately and reach it only on a network that is
already authenticated.

## Stateless and stateful

`sessions` defaults to `"stateless"`: each request builds a server and a
transport, and both are closed when the response body ends or the client
disconnects. That is the shape a serverless host needs.

`sessions: "stateful"` keeps one transport per `mcp-session-id` for the life of
the client session. A `DELETE` ends it, an unknown id is a `404`, and
`application.close()` closes every transport the boot still holds. The session
store is in memory, so stateful mode is one instance.

`jsonResponse: true` asks for JSON bodies instead of Server-Sent Events. The SDK
default is `false`, and a client must still send `Accept: application/json,
text/event-stream`.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

`aponia build` cannot lower a registration: a `DynamicModule` in `imports` is
declined, and the boot lowers the root from its decorators instead. The endpoint
still mounts; what is given up is the declared-graph boot.

## Native escape hatch

An application that needs a transport shape this package does not own mounts
the SDK itself:

```ts
import { Module } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Elysia } from "elysia";

const endpoint = new Elysia({ name: "mcp-endpoint" }).all("/mcp", async ({ request }) => {
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = new McpServer({ name: "my-app", version: "1.0.0" });
  await server.connect(transport);
  return transport.handleRequest(request);
});

const mcp = PluginModule.register(endpoint, { key: "mcp" });

@Module({ imports: [mcp] })
export class AppModule {}
```

That path gives up the validated policy, the Origin refusal, and the session
cleanup this package contributes.
