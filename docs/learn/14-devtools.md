# 14 · Devtools

**Use when:** inspecting what the application compiled and which requests it answered.

`@aponiajs/devtools` mounts a read-only HTTP API at `/__devtools` on the application's own address.

```bash
bun add @aponiajs/devtools@alpha
```

## Register it

Pass the plugin to the factory so a generated descriptor keeps booting:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { devtoolsPlugin } from "@aponiajs/devtools";
import { appLogger } from "./logger.ts";

const application = await AponiaFactory.create(AppModule, {
  logger: appLogger,
  plugins: [devtoolsPlugin({ enabled: Bun.env.APONIA_DEVTOOLS === "true", logger: appLogger })],
});
```

The module spelling mounts the same surface:

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({ imports: [DevtoolsModule.register({ enabled: true, logger: appLogger })] })
export class AppModule {}
```

`enabled` is required. The framework never reads an environment variable to decide whether devtools load. Pass the same logger object to `AponiaFactory.create` and to the registration.

| Option      | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `enabled`   | Mount the devtools surface. Required.                |
| `authorize` | Authorizes one request; a `false` answer is a `401`. |
| `logger`    | Logger recorded by `/logs`, or `false`.              |
| `capture`   | Per-field opt-out for `/requests`, or `false`.       |

## Endpoints

| Endpoint   | Answers                                |
| ---------- | -------------------------------------- |
| `meta`     | Contract version, releases, start time |
| `graph`    | Module graph compiled at boot          |
| `routes`   | Routes the application answers         |
| `flow`     | Stages and filters per route           |
| `logs`     | Log entries from a cursor              |
| `requests` | Recorded requests and responses        |
| `aot`      | Build decisions for generated invokers |

```bash
curl http://localhost:3000/__devtools/routes
```

`/logs` and `/requests` are polled with the cursor from the previous answer. A request writes an arrival entry and a completion entry with the same `id`; group by `id` and keep the last entry in the window.

The surface is one wildcard route, `ALL /__devtools/*`, in the application's own route table. It answers under `application.handle()` and `listen()`. A more specific application route wins. `enabled` is how production keeps it out.

`/requests` records request headers and bodies by default. Treat the surface as a development tool.

Devtools serve JSON only. There is no UI, asset bundle, or mutation endpoint.

Next: [15 · Files](./15-files.md) · Deep dive: [devtools](../services/devtools.md)
