# 14 · Devtools

**Use when:** you need to see what a running application compiled, serves, logged, or answered, in development.

The devtools surface answers what your running application actually is: the
graph it compiled, the routes it serves, the stages each route runs, the lines
it logged, and the requests it answered. Turn it on deliberately in development.

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({
  imports: [DevtoolsModule.forRoot({ enabled: Bun.env.NODE_ENV !== "production" })],
})
export class AppModule {}
```

Nothing is mounted while `enabled` is false. While it is true, the surface is a
controller under `/__devtools` on the address the application already answers,
and it reports from the neutral boot record, so the same registration works on
`@aponiajs/platform-elysia`, `@aponiajs/platform-hono`,
`@aponiajs/platform-h3`, and the serverless Web Fetch handler.

Open `/__devtools` for the page, or read the endpoints directly:

| Path                   | Answers                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `/__devtools/meta`     | contract version, boot release, artifact stamps                          |
| `/__devtools/graph`    | the compiled modules, providers, controllers, routes, gateways           |
| `/__devtools/routes`   | the compiled plans and callback routes                                   |
| `/__devtools/flow`     | each route's validation, guards, interceptors, binding, handler, filters |
| `/__devtools/aot`      | the build verdict for the project                                        |
| `/__devtools/logs`     | the log stream, read from a cursor                                       |
| `/__devtools/requests` | the request record, read from a cursor                                   |

Two limits are stated rather than hidden. A plugin's own contributed hooks — a
`derive`, a `resolve`, a native `beforeHandle` — are not part of the neutral
record, so `/flow` reports the compiled plan's stages and not those
contributions. And a route mounted directly on a native application, outside the
module graph, is not reported by `/routes` or `/flow`.

`DevtoolsModule.forRoot({ enabled })` is the only registration; there is no
plugin option, and no platform package appears in this package's source.

Next: [15 · Testing](./15-testing.md) · Deep dive: [devtools](../services/devtools.md)
