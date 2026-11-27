# @aponiajs/mcp

```bash
bun add @aponiajs/mcp @modelcontextprotocol/server zod
```

Serve a Model Context Protocol endpoint from an Aponia application. Tools,
resources, and prompts are methods of providers, declared with decorators and
discovered when the endpoint mounts.

## Use it

### Register the module

`McpModule.forRoot` returns the `DynamicModule` an `imports` entry accepts. The
module mounts the endpoint and discovers the primitives on the providers in the
graph:

```ts
import { Module } from "@aponiajs/common";
import { McpModule } from "@aponiajs/mcp";
import { OrdersTools } from "./orders.tools.ts";

@Module({
  imports: [McpModule.forRoot({ name: "orders", version: "1.0.0" })],
  providers: [OrdersTools],
})
export class AppModule {}
```

### Declare a tool

A tool is a method of a provider decorated with `@Tool`. The method name is the
tool name unless `name` says otherwise; the first argument is the validated
input, and the second is the `McpContext`:

```ts
import { Injectable } from "@aponiajs/common";
import { Tool, type McpContext } from "@aponiajs/mcp";
import { z } from "zod";

@Injectable()
export class OrdersTools {
  @Tool({
    description: "Find one order",
    inputSchema: z.object({ orderId: z.string() }),
  })
  findOrder({ orderId }: { orderId: string }, _context: McpContext): string {
    return `order-${orderId}`;
  }
}
```

`@Tool`, `@Prompt`, `@Resource`, and `@ResourceTemplate` are metadata-only and
re-exported from `@aponiajs/common`. The module discovers them at mount time; an
`include` list narrows the search to the modules it names. The HTTP endpoint is
mounted at `/mcp` by default — `path` moves it, and `path: false` disables HTTP
for a stdio-only application — and a tool is reached through that endpoint, not
through a controller route.

### Tools are not HTTP routes

The endpoint is mounted by the module, not declared by a controller. A
controller beside it keeps its own routes, and the tools never appear in them:

```ts
import { Controller, Get, Param } from "@aponiajs/common";

@Controller("orders")
export class OrdersController {
  @Get(":id")
  read(@Param("id") id: string): string {
    return `order-${id}`;
  }
}
```

`GET /orders/:id` stays an ordinary Aponia route; `findOrder` is reached only by
a JSON-RPC call to `/mcp`.

### Call the endpoint

The HTTP transport accepts `POST /mcp`. Each request builds one SDK server and
closes it when the response ends, so no state survives the request:

```bash
curl -s http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

The answer is `200` with the server's `initialize` result, as JSON or as an SSE
frame in the negotiated mode. `tools/list` then names `findOrder`, and a
`tools/call` with `{ "name": "findOrder", "arguments": { "orderId": "A-1" } }`
answers `200` with a text content block whose text is `order-A-1`. A foreign
`Origin`, an oversized body, a non-JSON content type, and a method other than
`POST` are refused with `403`, `413`, `415`, and `405` before dispatch.

### Async registration

`McpModule.forRootAsync` builds the server metadata (`name`, `version`, `title`,
`instructions`, and the transport policy) from a factory. `path`, `include`,
`key`, and the enhancer lists stay at the top level, because the route and the
graph it mounts against are fixed when the module is registered:

```ts
import { Module } from "@aponiajs/common";
import { McpModule } from "@aponiajs/mcp";
import { SettingsModule } from "./settings.module.ts";
import { SettingsService } from "./settings.service.ts";

const mcp = McpModule.forRootAsync({
  imports: [SettingsModule],
  inject: [SettingsService],
  useFactory: async (settings: SettingsService) => ({
    name: settings.name,
    version: settings.version,
    instructions: "Order tools",
  }),
  path: "/mcp",
});

@Module({ imports: [mcp] })
export class AppModule {}
```

The Promise a factory answers is awaited before the runtime reads the resolved
options. `imports` lists the module that exports the injected provider, so
`SettingsModule` must export `SettingsService`. `useClass` names a class the
container constructs and then asks through `create()`, and `useExisting` aliases
a provider that already implements it.

## Primitives

```ts
import { Prompt, Resource, ResourceTemplate, Tool } from "@aponiajs/mcp";
```

- `@Tool({ inputSchema, outputSchema?, description?, annotations? })` receives the validated arguments and an `McpContext`.
- `@Resource({ uri, mimeType? })` answers one fixed URI.
- `@ResourceTemplate({ uriTemplate })` answers every URI the RFC 6570 template matches and receives the variables.
- `@Prompt({ argsSchema })` answers a prompt template.

Names default to the method name and must use 1-128 characters of
`A-Z a-z 0-9 _ - .`. A duplicate name, an invalid name, or an `include` entry
that names no module fails the mount with an `AponiaError`.

## Enhancers

Every call runs through the same enhancer model as a route:

1. guards from the module options, the class, and the method;
2. interceptors' `interceptBefore` halves;
3. pipes, with the input bound as the call's body;
4. the method;
5. interceptors' `interceptAfter` halves, reversed;
6. filters when the method throws.

`getType()` answers `"mcp"`, and `McpExecutionContext.create(context)` reads the
call, the input, the context, and the platform request.

## Transports

The HTTP endpoint defaults to `/mcp`. Each request builds one SDK server and
closes it when the response ends, so no state survives the request. Set
`path: false` for a stdio-only application.

```ts
import { serveMcpStdio } from "@aponiajs/mcp";

const handle = serveMcpStdio(application);
// stdout carries protocol frames; diagnostics belong on stderr.
```

`listenMcpStdio(application)` resolves when the client closes stdin and closes
the connection afterwards.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Native escape hatch

An application that needs a transport or server shape this package does not
model mounts the SDK itself.

```ts
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { PluginModule } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "app", version: "1.0.0" });
  return server;
});
const endpoint = new Elysia({ name: "mcp" }).all("/mcp", ({ request }) => handler.fetch(request));
const mcp = PluginModule.register(endpoint, { key: "mcp" });
```

That path gives up discovery, the enhancer pipeline, and the validated options
this package contributes.
