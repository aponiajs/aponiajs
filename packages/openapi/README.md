# @aponiajs/openapi

```bash
bun add @aponiajs/openapi
```

Serve an OpenAPI document for an Aponia application's routes, with the
document's own metadata read from a validated configuration.

## What this package is, and what it is not

**This package generates no schema and no document.** The generator is
[`@elysia/openapi`](https://www.npmjs.com/package/@elysia/openapi), which reads
the route table Elysia compiled. This package is a thin adapter over that
plugin, and it contributes exactly two things:

- a module the plugin is declared in, so the document is mounted through the
  framework's own seam, is part of the compiled graph, and can be read back from
  it;
- a validated configuration the document's `info` comes from, so a missing or
  malformed title and version is a refused boot with a code and an issue list,
  rather than a document served with a placeholder nobody declared.

Everything else — which routes appear, what each schema looks like, how a
parameter is lowered into a path item — is `@elysia/openapi`'s. **A reader who
wants the raw plugin should use
[`@elysia/openapi`](https://www.npmjs.com/package/@elysia/openapi) directly**:
nothing here is unavailable there, and mounting it yourself through a
`PluginModule` costs a few lines.

Read the next paragraph before you rely on anything downstream of the document.

**This package does not validate requests, does not generate clients, and serves
no interface of its own.** The document it serves is a _description_ of the
routes the platform compiled; it is not a validator, and nothing in this package
makes a request conform to what the document says. A client generated from the
document is a third-party generator's reading of it, with that generator's own
gaps. The one interface this package offers is whatever the wrapped plugin serves
at the mount path — Scalar's page by default — and that page is
`@elysia/openapi`'s, with its own configuration and its own Scalar version. **A
reader who assumes the document is a contract the server enforces will ship a
client for endpoints that answer `422`, or an integration against a route that
was never declared**, and no option here changes that: a package that promises
enforcement is a different package, and this one deliberately does not pretend
to be it.

## Declaring a document

`OpenApiModule.register` returns a `DynamicModule`, which is what an `imports`
entry accepts:

```ts
import { Module } from "@aponiajs/common";
import { OpenApiModule } from "@aponiajs/openapi";
import { OpenApiConfig } from "./config.ts";

const docs = OpenApiModule.register({ configuration: OpenApiConfig });

@Module({ imports: [docs], controllers: [WidgetsController] })
export class AppModule {}
```

`path` moves the mount point and defaults to `"/openapi"`, where the wrapped
plugin's default also puts it. The document is served at `${path}/json` and the
interface at `${path}`, both spelled by the plugin. A `path` that is not an
absolute path is refused with a `TypeError` while the registration runs,
because it is written in source where a wrong one is a programming mistake
rather than data an environment supplied.

`key` names the module's identity and defaults to `"openapi"`. Two registrations
that share one key are one module identity, which the graph refuses as a
duplicate rather than quietly serving one document twice.

## The validated configuration

The document's metadata comes from a configuration the application declares and
the module validates, not from the plugin's defaults:

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
without them is one no tool will read. What this shape buys is that a
deployment which supplied neither is refused before anything is served, with
`INVALID_CONFIGURATION_VALUE` and a list of the fields that were wrong, rather
than a document carrying the plugin's placeholder — `"Elysia Documentation"`,
`"0.0.0"` — which is a claim the application never made.

An absent `description` is served as no description at all, not as the plugin's
`"Development documentation"`. That placeholder is the one default this package
overrides rather than inherits, for the same reason.

`OpenApiModule.register` provides this token itself, from `process.env`, and
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
- **A WebSocket gateway is not in the document.** The platform mounts a gateway
  as a route whose method really is `ws`, which is not an OpenAPI path-item
  field: left in, it is an object no validator accepts. This package mounts the
  plugin with `exclude.methods: ["options", "ws"]` for that reason, so the HTTP
  operations stand alone.

## One document per application

Elysia mounts a _named_ plugin once. `@elysia/openapi`'s plugin is named, and a
second instance is skipped rather than mounted, so an application that declares
two registrations with distinct keys gets two graph nodes and **one document** —
whichever registration mounted first, at that registration's path. The second
path answers `404`, and reading the shared configuration token back raises
`AMBIGUOUS_PROVIDER` rather than picking a winner. One registration per
application is the supported shape.

## The `plugins` option is a different path

Mounting the plugin yourself through `AponiaApplicationOptions.plugins`, or
through a bare `PluginModule.register`, mounts the _same_ plugin rather than a
document built by this one: no configuration is validated, and the document's
metadata is whatever you passed the raw plugin. That is a supported way to mount
it — see [Native Elysia Plugins](../../docs/native-plugins.md) — and it is not a
way to use this package.

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

## Requirements

`elysia` is a peer dependency and must be installed by the application;
`@elysia/openapi` is a dependency of this package and is installed with it. The
plugin's own peer dependencies — `typebox` and `@scalar/types` — are type-only
and are not needed at run time.

## Links

- [Package README](./README.md)
- [`@elysia/openapi` on npm](https://www.npmjs.com/package/@elysia/openapi)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Plugin package authoring](../../docs/plugin-packages.md)
- [Native Elysia Plugins](../../docs/native-plugins.md)
- [Configuration](../../docs/configuration.md)
- [Published packages](../../docs/packages.md)
