# OpenAPI

`@aponiajs/openapi` serves an OpenAPI document for the routes an application
compiled, and takes the document's own metadata from a validated configuration.
It is a neutral module: the document is built from the compiled route plans and
served by a controller on the application's own route table, so the same
registration answers the same document on every platform.

## What the document is not

The document **describes** the routes the application compiled. It does not
validate a request, generate a client, or serve a UI of its own beyond the small
HTML index beside the document. Nothing here makes a request conform to what the
document says; a request that violates every schema in it reaches the handler
unless the route's own `@Validation` refuses it first, and what answers then is
the framework's ordinary `422`, not the document.

A client generated from the document is a third-party generator's reading of it,
with that generator's own gaps. A reader who assumes the document is a contract
the server enforces ships a client for endpoints that answer `422`, or an
integration against a route that was never declared. There is no option here
that changes that; enforcement is a different package.

## Registration

```ts
import { Module } from "@aponiajs/common";
import { OpenApiModule } from "@aponiajs/openapi";
import { WidgetsController } from "./widgets.controller.ts";
import { OpenApiConfig } from "./openapi.config.ts";

const docs = OpenApiModule.forRoot({ configuration: OpenApiConfig });

@Module({ imports: [docs], controllers: [WidgetsController] })
export class AppModule {}
```

The document is served as JSON at `"/openapi/json"` and the HTML index at
`"/openapi"`, both moved together by `path`. `key` names the module's identity
and defaults to `"openapi"`; two registrations that share one key are refused as
`DUPLICATE_MODULE` rather than serving one document twice.

`aponia build` declines a module whose `imports` name a registration — a
registration is not a `@Module()` class, so no spelling of the call keeps the
module lowerable. The application still boots and serves the document, because
the platform lowers such a root from its decorators; what the decline costs is
the lowering, not the application.

## The validated configuration

The metadata comes from a `defineConfiguration` declaration rather than a
literal, so a deployment that supplied neither a title nor a version is refused
before anything is served:

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

export const OpenApiConfig = defineConfiguration(
  z
    .object({
      OPENAPI_TITLE: z.string().min(1).default("Widgets API"),
      OPENAPI_VERSION: z.string().min(1).default("1.0.0"),
      OPENAPI_DESCRIPTION: z.string().optional(),
    })
    .transform(({ OPENAPI_TITLE, OPENAPI_VERSION, OPENAPI_DESCRIPTION }) => ({
      info: {
        title: OPENAPI_TITLE,
        version: OPENAPI_VERSION,
        description: OPENAPI_DESCRIPTION,
      },
    })),
  "openapi.config",
);
```

`title` and `version` are required because OpenAPI requires them: a document
without them is one no tool reads. This package does not fill them with a
placeholder; what it serves is what the application declared, and an absent
description is served as no description at all.

The module provides this token itself, from `process.env`, and exports it, so
the application reads the same value back through
`application.get(OpenApiConfig)`. `source` overrides what the schema validates —
a literal record instead of the environment — which is what a test passes.

## What the document reflects

| Declaration                                                                        | In the document                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `@Controller("widgets")` and `@Get(":id")`                                         | the path `/widgets/{id}` and its `get` operation                    |
| a route with no schema                                                             | the operation, with no request body                                 |
| `body` — a raw validator or a `@Validation` class                                  | `requestBody`                                                       |
| `query`, `params`, `headers`, `cookie`                                             | `parameters`, under `in: "query"`, `"path"`, `"header"`, `"cookie"` |
| `response`, one validator                                                          | the `200` answer                                                    |
| `response`, a status map such as `{ 201, 404 }`                                    | the status-specific `responses`                                     |
| `operationId`, `summary`, `tags`, `security`, `servers`, a validation model's name | nothing — the framework declares none of them                       |

Two absences are worth stating plainly, because a reader meets them in the
document rather than in a message:

- **`components.schemas` is empty.** It is the platform's model registry, and
  AponiaJS registers no model. Every declared schema is inlined into the
  operation that declared it, so a document generated here is longer than one
  built from a registry and its schemas cannot be shared by `$ref`.
- **A route a registration callback mounted is not in the document.** Only
  compiled plans are described, because a callback route has no plan to read.
  A WebSocket gateway is not an HTTP operation either; `ALL`, `OPTIONS`, and
  `HEAD` are omitted.
- **A deprecated route is marked.** `@Deprecated()` sets `detail.deprecated`, so
  the operation carries `deprecated: true` next to the route's deprecation
  headers.

## One document per application

A registration is one graph node with one identity. Two registrations with
distinct keys produce two graph nodes and two controllers; each path serves the
document its own configuration describes. Both modules export the same
configuration token, so reading it back raises `AMBIGUOUS_PROVIDER` rather than
picking a winner. One registration per application is the supported shape.

## Errors

| Code                          | When                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_CONFIGURATION_VALUE` | the schema rejected the value, or the value it produced is not an `{ info }` object with a non-empty `title` and `version` |
| `INVALID_CONFIGURATION`       | the declaration is not a Standard Schema, or its validation answers asynchronously — `provideConfiguration`'s own refusal  |

Both value refusals carry `{ configuration, issues }`, and the issue list is
total: every field that fails is reported at once, so one boot names every field
to fix. A `path` that is not absolute is a `TypeError` raised while the
registration runs, not an `AponiaError`: it is a source-level mistake rather
than a value an environment supplied.

The document answers `503` when it is asked before a boot published the
application container.

## Links

- [Package README](../../packages/openapi/README.md)
- [Authoring a plugin package](../tooling/plugin-packages.md)
- [Platform parity](../platforms/platform-parity.md)
- [Configuration](../build/configuration.md)
