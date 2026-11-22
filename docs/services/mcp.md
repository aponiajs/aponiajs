# Model Context Protocol (MCP)

Serve a Model Context Protocol endpoint from an Aponia application. Tools,
resources, and prompts are decorated provider methods; the module discovers them
when the endpoint mounts and serves them through the official
[`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)
SDK. This page covers the registration, the decorators, the enhancer pipeline,
and both transports.

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

The module serves `/mcp` beside the application's routes. `forRootAsync` builds
the metadata from a factory, with `path`, `include`, and the enhancer lists kept
at the top level because they are fixed when the module is defined.

## Primitives

| Decorator             | Options                                                             | Method arguments   |
| --------------------- | ------------------------------------------------------------------- | ------------------ |
| `@Tool()`             | `name`, `description`, `inputSchema`, `outputSchema`, `annotations` | `(input, ctx)`     |
| `@Resource()`         | `uri`, `mimeType`, `size`                                           | `(_input, ctx)`    |
| `@ResourceTemplate()` | `uriTemplate`, `mimeType`                                           | `(variables, ctx)` |
| `@Prompt()`           | `name`, `description`, `argsSchema`                                 | `(args, ctx)`      |

Names default to the method name and must use 1-128 characters of
`A-Z a-z 0-9 _ - .`. A duplicate name, an invalid name, or an `include` entry
that names no module fails the mount with `AponiaError`.

`McpContext` carries `kind`, `name`, `uri`, `transport`, `requestInfo`,
`request`, `signal`, and the SDK's own context.

## Enhancers

Every call runs through the same enhancer model as a route.

1. Guards from `McpModule.forRoot({ guards })`, then the class, then the method.
2. Interceptors' `interceptBefore` halves.
3. Pipes, with the input bound as the call's body.
4. The method.
5. Interceptors' `interceptAfter` halves, reversed.
6. Filters when the method throws.

`ExecutionContext.getType()` answers `"mcp"`. `McpExecutionContext.create(context)`
reads `getInput()`, `getKind()`, `getName()`, `getRequest()`, and `getMcpContext()`.

HTTP globals passed to `AponiaFactory.create` are not inherited by MCP calls.
Pass the same enhancer classes to `McpModule.forRoot` when they should run.

## Transports

HTTP

- `path` defaults to `/mcp`; `false` disables HTTP.
- Each request gets one SDK server and one transport, closed when the response ends.
- A browser `Origin` not in `http.allowedOrigins` is a `403`; the default list is `localhost`, `127.0.0.1`, and `[::1]`.
- `http.allowedHosts` checks the `Host` header.
- `http.maxRequestBodySize` defaults to 4 MiB and answers `413`.

stdio

```ts
import { listenMcpStdio } from "@aponiajs/mcp";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await listenMcpStdio(application);
```

stdout carries protocol frames only. `serveMcpStdio` returns the SDK handle when
an application owns the loop itself.

## Verification

```bash
bun test packages/mcp/tests
bun test examples/mcp/test/mcp.e2e-spec.ts
bun run check
```

[Package README](../../packages/mcp/README.md) ·
[Package catalog](../reference/packages.md)
