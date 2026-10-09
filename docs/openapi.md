# OpenAPI

`@aponiajs/openapi` serves an OpenAPI document for the routes an application
compiled, and takes the document's own metadata from a validated configuration.

It is a thin adapter over
[`@elysia/openapi`](https://www.npmjs.com/package/@elysia/openapi), which builds
the document from the route table Elysia compiled. AponiaJS contributes a module
the plugin is declared in and a validated configuration the `info` comes from.
Everything else — which routes appear, what a schema looks like, how a parameter
is lowered into a path item, and the page served beside the document — is the
wrapped plugin's.

## What the document is not

The document **describes** the routes the platform compiled. It does not
validate a request, generate a client, or serve an interface of this package's
own. Nothing here makes a request conform to what the document says; a request
that violates every schema in it reaches the handler unless the route's own
`@Validation` refuses it first, and what answers then is the framework's
ordinary `422`, not the document.

A client generated from the document is a third-party generator's reading of it,
with that generator's own gaps, and the page served at the mount path is
Scalar's — the wrapped plugin's, with the plugin's own options and version. A
reader who assumes the document is a contract the server enforces ships a client
for endpoints that answer `422`, or an integration against a route that was never
declared. There is no option here that changes that; enforcement is a different
package.

A reader who wants the raw plugin should install
[`@elysia/openapi`](https://www.npmjs.com/package/@elysia/openapi) directly: see
[Native Elysia Plugins](./native-plugins.md) for both the `plugins` option and
`definePlugin`.

## Registration

```ts
import { Module } from "@aponiajs/common";
import { OpenApiModule } from "@aponiajs/openapi";
import { WidgetsController } from "./widgets.controller.ts";
import { OpenApiConfig } from "./openapi.config.ts";

const docs = OpenApiModule.register({ configuration: OpenApiConfig });

@Module({ imports: [docs], controllers: [WidgetsController] })
export class AppModule {}
```

The document is served at `"/openapi/json"` and the interface at `"/openapi"`,
both moved together by `path`. `key` names the module's identity and defaults to
`"openapi"`; two registrations that share one key are refused as
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
without them is one no tool reads. Without this package the plugin fills them
with `"Elysia Documentation"` and `"0.0.0"`, and fills an absent description
with `"Development documentation"` — claims the application never made, served
to every consumer of the document. This package overrides all three: what it
serves is what the application declared, and an absent description is served as
no description at all.

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
- **A WebSocket gateway is not in the document.** The platform mounts a gateway
  as a route whose method really is `ws`, and `ws` is not an OpenAPI path-item
  field: left in, the document carries a path item no validator accepts. The
  registration mounts the plugin with `exclude.methods: ["options", "ws"]` for
  that reason.

## One document per application

Elysia mounts a _named_ plugin once. `@elysia/openapi`'s plugin is named, and a
second instance is skipped rather than mounted, so an application that declares
two registrations with distinct keys gets two graph nodes and one document: the
one whose registration mounted first, at that registration's path. The second
path answers `404`, and because both modules export the same configuration
token, reading it back raises `AMBIGUOUS_PROVIDER` rather than picking a winner.
One registration per application is the supported shape.

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

## Links

- [Package README](../packages/openapi/README.md)
- [Authoring a plugin package](./plugin-packages.md)
- [Native Elysia Plugins](./native-plugins.md)
- [Configuration](./configuration.md)
- [`@elysia/openapi` on npm](https://www.npmjs.com/package/@elysia/openapi)
