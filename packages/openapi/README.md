# @aponiajs/openapi

```bash
bun add @aponiajs/openapi
```

Serve an OpenAPI document for an Aponia application's routes, with the
document's own metadata read from a validated configuration.

## Use it

### Register the module

`OpenApiModule.forRoot` returns the `DynamicModule` the application's `imports`
accepts. The registration mounts the document controller; the routes the
document describes are the controllers the same application declares:

```ts
import { Module } from "@aponiajs/common";
import { OpenApiModule } from "@aponiajs/openapi";
import { OpenApiConfig } from "./openapi.config.ts";
import { WidgetsController } from "./widgets.controller.ts";

const docs = OpenApiModule.forRoot({ configuration: OpenApiConfig });

@Module({ imports: [docs], controllers: [WidgetsController] })
export class AppModule {}
```

### Use it in a controller

The document is a reading of the compiled route plans, so a controller declares
its routes and schemas exactly as it does without this package:

```ts
import { Body, Controller, Get, Param, Post, Validation } from "@aponiajs/common";
import { z } from "zod";

const createWidgetSchema = z.object({ name: z.string().min(2) });

@Validation(createWidgetSchema)
class CreateWidget {}
interface CreateWidget {
  readonly name: string;
}

@Controller("widgets")
export class WidgetsController {
  @Get(":id")
  read(@Param("id") id: string): { id: string; name: string } {
    return { id, name: "widget" };
  }

  @Post("/", { body: CreateWidget })
  create(@Body() body: CreateWidget): { id: string; name: string } {
    return { id: "1", name: body.name };
  }
}
```

`GET /widgets/{id}` appears with its path parameter, and `POST /widgets` with a
`requestBody` and a `200` response. The document describes these routes; it does
not enforce them.

### Call the endpoint

The document is served at `${path}/json` and the HTML index at `${path}`, with
`path` defaulting to `/openapi`:

```ts
const document = await application.handle(new Request("http://localhost/openapi/json"));

document.status; // 200
await document.json(); // { openapi: "3.…", info: { title: "Widgets API", version: "1.0.0" }, paths: { … } }

const page = await application.handle(new Request("http://localhost/openapi"));
page.headers.get("content-type"); // text/html
```

`path: "/docs"` moves both: `GET /docs/json` answers, and `GET /openapi/json` is
`404`.

### Async registration

`OpenApiModule` exports `forRoot`, plus the deprecated `register` alias, and no
`forRootAsync` or `registerAsync`. A registration has one input — the validated
configuration — and `provideConfiguration` validates it synchronously, so there
is nothing to await. The document's paths are not registration options at all:
they are read from the compiled route plans inside a boot, which a factory that
runs while the module is registered cannot observe.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Declaring a document

`OpenApiModule.forRoot` returns a `DynamicModule`, which is what an `imports`
entry accepts:

```ts
import { Module } from "@aponiajs/common";
import { OpenApiModule } from "@aponiajs/openapi";
import { OpenApiConfig } from "./config.ts";

const docs = OpenApiModule.forRoot({ configuration: OpenApiConfig });

@Module({ imports: [docs], controllers: [WidgetsController] })
export class AppModule {}
```

`path` moves the mount point and defaults to `"/openapi"`. The document is
served at `${path}/json` and the HTML index at `${path}`. A `path` that is not an
absolute path is refused with a `TypeError` while the registration runs, because
it is written in source where a wrong one is a programming mistake rather than
data an environment supplied.

`key` names the module's identity and defaults to `"openapi"`. Two registrations
that share one key are one module identity, which the graph refuses as a
duplicate rather than quietly serving one document twice.

## The validated configuration

The document's metadata comes from a configuration the application declares and
the module validates, not from a placeholder:

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

`title` and `version` are required because OpenAPI requires them; a document
without them is one no tool will read. What this shape buys is that a deployment
which supplied neither is refused before anything is served, with
`INVALID_CONFIGURATION_VALUE` and a list of the fields that were wrong, rather
than a document carrying a placeholder claim the application never made.

An absent `description` is served as no description at all rather than as a
generated placeholder, for the same reason.

`OpenApiModule.forRoot` provides this token itself, from `process.env`, and
exports it, so the application can read the same validated value back:

```ts
const application = await AponiaFactory.create(AppModule);

application.get(OpenApiConfig); // the value the document carries
```

`source` overrides what the schema validates — a literal record instead of the
environment — which is what a test passes.

## What the document reflects

The document is a reading of the compiled route table, so it reflects what the
platform lowered from the route decorations, and nothing else:

| Declaration                                                                        | In the document                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `@Controller("widgets")` + `@Get(":id")`                                           | the path `/widgets/{id}` and the `get` operation                    |
| a route with no schema                                                             | the operation, with no request body                                 |
| `body` — a raw validator or a `@Validation` class                                  | `requestBody`                                                       |
| `query`, `params`, `headers`, `cookie`                                             | `parameters`, under `in: "query"`, `"path"`, `"header"`, `"cookie"` |
| `response`, one validator                                                          | the `200` answer                                                    |
| `response`, a status map such as `{ 201, 404 }`                                    | the status-specific `responses`                                     |
| `operationId`, `summary`, `tags`, `security`, `servers`, `@Validation` model names | nothing. The framework declares none of them.                       |

Two things follow that a reader should know rather than discover:

- **`components.schemas` is empty.** It is the platform's model registry, and
  AponiaJS registers no model: every declared schema is inlined into the
  operation that declared it. A document generated here is longer than one built
  from a registry, and its schemas are not reusable by `$ref`.
- **A WebSocket gateway is not in the document.** A gateway is a compiled
  gateway plan rather than an HTTP route, so it contributes no operation. `ALL`,
  `OPTIONS`, and `HEAD` routes are omitted for the same reason: an OpenAPI path
  item has no field for them.
- **A deprecated route is marked.** `@Deprecated()` writes the route's
  `detail.deprecated` flag, so the operation carries `deprecated: true` beside
  the response headers the route sends.

## One document per application

A registration is one graph node with one identity and one controller. An
application that declares two registrations with distinct keys gets two graph
nodes and two controllers; each path serves the document its own configuration
describes. Both modules export the same configuration token, so reading it back
raises `AMBIGUOUS_PROVIDER` rather than picking a winner. One registration per
application is the supported shape.

## Serving a document another way

Mounting some other OpenAPI plugin yourself through
`AponiaApplicationOptions.plugins`, or through `PluginModule.register`, is an
application decision: no configuration here is validated, and the document's
metadata is whatever that plugin was given. It is not a way to use this package.
See [Native Elysia Plugins](../../docs/platforms/native-plugins.md).

## Errors

A configuration this package refuses raises `AponiaError` with:

- `INVALID_CONFIGURATION_VALUE` when the schema rejects the value, or when the
  value the schema produced is not an `{ info }` object with a non-empty `title`
  and `version`. Both carry `{ configuration, issues }`, and the issue list is
  total — every field that fails is reported, so one boot names every field to
  fix.
- `INVALID_CONFIGURATION` when the declaration is not a Standard Schema, or its
  validation answers asynchronously, both of which `provideConfiguration`
  already refuses for any configuration.

A `path` that is not absolute is a `TypeError` raised while the registration
runs, not an `AponiaError`: it is a source-level mistake rather than a value an
environment supplied.

## Native escape hatch

The module above is the supported path. The document is built by this package
from the compiled route plans and served by a controller on the application's
own route table, so it runs on every platform without a native plugin. An
application that wants a different OpenAPI implementation mounts that plugin
itself through `AponiaApplicationOptions.plugins` and keeps its own metadata;
that is not a way to use this package.

**This package does not validate requests, does not generate clients, and serves
no interface of its own.** The document it serves is a _description_ of the
routes the platform compiled; it is not a validator, and nothing in this package
makes a request conform to what the document says. A client generated from the
document is a third-party generator's reading of it, with that generator's own
gaps. The HTML index beside the document is this package's own small page, not a
rendered API console. **A reader who assumes the document is a contract the
server enforces will ship a client for endpoints that answer `422`, or an
integration against a route that was never declared**, and no option here
changes that: a package that promises enforcement is a different package, and
this one deliberately does not pretend to be it.

## Requirements

The package depends on `@aponiajs/common`, `@aponiajs/core`, and
`@aponiajs/platform-core`. It has no Elysia or HTTP-runtime dependency.

## Links

- [Package README](./README.md)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Plugin package authoring](../../docs/tooling/plugin-packages.md)
- [Platform parity](../../docs/platforms/platform-parity.md)
- [Configuration](../../docs/build/configuration.md)
- [Published packages](../../docs/reference/packages.md)
