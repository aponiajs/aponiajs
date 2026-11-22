# @aponiajs/mcp

```bash
bun add @aponiajs/mcp @modelcontextprotocol/server zod
```

Serve a Model Context Protocol endpoint from an Aponia application. Tools,
resources, and prompts are methods of providers, declared with decorators and
discovered when the endpoint mounts.

## Use it

```ts
import { Injectable, Module } from "@aponiajs/common";
import { McpModule, Tool, type McpContext } from "@aponiajs/mcp";
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

@Module({
  imports: [McpModule.forRoot({ name: "cat-store", version: "1.0.0" })],
  providers: [OrdersTools],
})
export class AppModule {}
```

`McpModule.forRootAsync({ imports, inject, useFactory })` builds the same
metadata from a factory. `path`, `include`, and the enhancer lists stay at the
top level because they are known when the module is defined.

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
