# @aponiajs/cors

```bash
bun add @aponiajs/cors
```

Answer cross-origin requests for an Aponia application, with the policy read
from a validated configuration.

## What this package is, and what it is not

**This package implements no CORS.** Every header, every preflight answer, and
every matching rule is
[`@elysia/cors`](https://www.npmjs.com/package/@elysia/cors)'s. This package is a
small adapter over that plugin, and it contributes exactly two things:

- a module the plugin is declared in, so the policy is mounted through the
  framework's own seam, is a node in the compiled graph, and is initialized in
  the boot's instance-loading pass — the `InstanceLoader` line reads
  `PluginModule[cors] dependencies initialized`;
- a validated configuration the policy comes from, so a missing origin, a
  malformed list, or a wildcard paired with credentialed requests is a refused
  boot with a code and an issue list, rather than a response nobody inspected.

**That is a thin contribution, and for a literal policy it may be no
contribution at all.** If your origins are a constant in source, this works and
needs no package:

```ts
import { Module } from "@aponiajs/common";
import { PluginModule } from "@aponiajs/platform-elysia";
import { cors } from "@elysia/cors";

const policy = PluginModule.register(cors({ origin: ["https://app.example"] }), { key: "cors" });

@Module({ imports: [policy], controllers: [WidgetsController] })
export class AppModule {}
```

What the module buys over that line is a graph node the policy is declared in
and a configuration the policy is validated from. **If neither matters to you,
use [`@elysia/cors`](https://www.npmjs.com/package/@elysia/cors) directly** —
nothing here is unavailable there, and the raw plugin is the only way to reach
the one thing a configuration cannot carry:

### What a configuration cannot express

The wrapped plugin's `origin` also accepts a **`RegExp`** or a
**`(request) => boolean` function**. Both are code, not data: no environment
variable holds them, and this package's configuration has no field for them. An
origin rule that is a pattern or a predicate is written as the raw plugin, and
`CorsModule` refuses a value a transform produced in its place with
`INVALID_CONFIGURATION_VALUE`:

```ts
// Not expressible through this package. Mount the raw plugin instead:
PluginModule.register(cors({ origin: /^https:\/\/.*\.example$/ }), { key: "cors" });
```

`CorsConfiguration.origins` is therefore a list of exact origin strings — a
value a deployment can supply, and nothing more.

## Declaring a policy

`CorsModule.register` returns a `DynamicModule`, which is what an `imports`
entry accepts:

```ts
import { Module } from "@aponiajs/common";
import { CorsModule } from "@aponiajs/cors";
import { CorsConfig } from "./config.ts";

const cors = CorsModule.register({ configuration: CorsConfig });

@Module({ imports: [cors], controllers: [WidgetsController] })
export class AppModule {}
```

`key` names the module's identity and defaults to `"cors"`. Two registrations
that share one key are one module identity, which the graph refuses as
`DUPLICATE_MODULE` rather than mounting one and dropping the other.

## The validated configuration

The policy comes from a configuration the application declares and the module
validates, not from the plugin's defaults:

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

export const CorsConfig = defineConfiguration(
  z
    .object({
      CORS_ORIGINS: z.string().min(1),
      CORS_CREDENTIALS: z.enum(["true", "false"]).default("false"),
    })
    .transform(({ CORS_ORIGINS, CORS_CREDENTIALS }) => ({
      origins: CORS_ORIGINS.split(",").map((origin) => origin.trim()),
      credentials: CORS_CREDENTIALS === "true",
    })),
  "cors.config",
);
```

| Field            | Required | Default                        | Refused when                                 |
| ---------------- | -------- | ------------------------------ | -------------------------------------------- |
| `origins`        | yes      | —                              | not a non-empty array of non-empty strings   |
| `methods`        | no       | the plugin's: echo the request | present but not a non-empty array of strings |
| `allowedHeaders` | no       | the plugin's: echo the request | present but not a non-empty array of strings |
| `exposeHeaders`  | no       | the plugin's: echo the request | present but not a non-empty array of strings |
| `credentials`    | no       | **`false`**                    | present but not a boolean                    |
| `maxAge`         | no       | `5`                            | present but not a non-negative number        |
| `preflight`      | no       | `true`                         | present but not a boolean                    |

`origins` is required, and `credentials` defaults to `false`, because **the
wrapped plugin's own defaults are permissive in a way this package will not
inherit silently**. `@elysia/cors` defaults `origin` to `true`, which reflects
whatever `Origin` a request carries, and defaults `credentials` to `true`: the
pair ships `Access-Control-Allow-Origin: <any site>` beside
`Access-Control-Allow-Credentials: true` on every response. An application that
wants credentialed requests says so — and must then name its origins, because
`origins: ["*"]` together with `credentials: true` is refused at boot: a browser
rejects that pair, so it is not a policy the server can serve.

`CorsModule.register` provides this token itself, from `process.env`, and
exports it, so the application reads the same validated value back:

```ts
application.get(CorsConfig); // the value the policy was built from
```

`source` overrides what the schema validates — a literal record instead of the
environment — which is what a test passes.

## What the policy answers

Measured through `application.handle`, with `origins: ["https://app.example"]`
and `credentials` left at its default:

| Request                                    | Answer                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `GET` from an allowed origin               | `Access-Control-Allow-Origin: https://app.example` and `Vary: Origin`                                              |
| `GET` from any other origin                | no `Access-Control-Allow-Origin`, and `Vary: Origin`                                                               |
| `GET` with no `Origin` at all              | no `Access-Control-Allow-Origin`                                                                                   |
| `OPTIONS` preflight from an allowed origin | `204`, the allow-origin, `Access-Control-Allow-Methods` echoing the requested method, and `Access-Control-Max-Age` |
| a request that matched no route            | `404`, with the policy's headers                                                                                   |
| `credentials: true`                        | every answer also states `Access-Control-Allow-Credentials: true`                                                  |

`methods`, `allowedHeaders`, and `exposeHeaders` are omitted above, which is the
plugin's own default of echoing the request: an allowed response additionally
carries `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, and
`Access-Control-Expose-Headers` naming what the request asked about. A policy
that declares those lists states them instead.

The plugin answers from a `request` hook that runs before routing, so an error
response carries the policy too — a browser reporting a CORS failure instead of
the `404` the server actually sent is the case that avoids.

`preflight: false` stops the plugin mounting its own `OPTIONS` routes, so a
preflight falls through to the application's own route table (`404` unless a
controller declares `OPTIONS`). The headers are still applied to that response.

## One registration per application

Elysia mounts a _named_ plugin once, and this plugin is named: it derives its
identity from the options it was handed. Two consequences, both measured:

- **Two registrations under one key** are `DUPLICATE_MODULE`
  (`{"module":"PluginModule[cors]"}`), whichever policies they resolve.
- **Two registrations under distinct keys that resolve equal policies** produce
  two graph nodes and one native mount — two `OPTIONS` routes, not four.
- **Two registrations under distinct keys that resolve different policies** both
  mount, and both answer: a request from either policy's origins is allowed.
  That is a union of two policies in one application, not two policies selected
  per request. One registration per application is the supported shape.

## `aponia build`

A registration returns a `DynamicModule`, which is not a `@Module()` class that
`aponia build` can read from the project's own source, so **a module whose
`imports` name one is declined** — reported in the emitter's `declined` list,
with the artifact holding nothing for it.

The application is whole anyway: a boot handed an artifact with no declaration
for the root module it was given lowers that root from its decorators instead,
and the policy answers. What the decline costs is the lowering, not the policy.
`tests/generated-descriptors.test.ts` measures both halves.

Unlike `@aponiajs/devtools`, this package cannot export a plugin value beside
the module: its plugin is built from a value the container resolves, so it
exists only inside a boot. An application that needs the route table untouched
by a registration mounts the raw plugin through
`AponiaApplicationOptions.plugins` — see
[Native Elysia Plugins](../../docs/native-plugins.md) — and gives up the module
and its validation to do it.

## Errors

A configuration this package refuses raises `AponiaError` with
`INVALID_CONFIGURATION_VALUE`, carrying `{ configuration, issues }`:

- when the schema rejects the value;
- when the value the schema produced is not an object with a usable `origins`;
- when any listed field is the wrong shape, or `"*"` is combined with
  `credentials: true`.

The issue list is total — every field that fails is reported, so one boot names
every field to fix. `INVALID_CONFIGURATION` covers a declaration that is not a
Standard Schema, or whose validation answers asynchronously, both of which
`provideConfiguration` already refuses for any configuration.

## Requirements

`elysia` is a peer dependency and must be installed by the application;
`@elysia/cors` is a dependency of this package and is installed with it.

## Links

- [Package README](./README.md)
- [`@elysia/cors` on npm](https://www.npmjs.com/package/@elysia/cors)
- [MDN: Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [Plugin package authoring](../../docs/plugin-packages.md)
- [Native Elysia Plugins](../../docs/native-plugins.md)
- [Configuration](../../docs/configuration.md)
- [Published packages](../../docs/packages.md)
