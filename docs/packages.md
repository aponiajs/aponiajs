# Published Packages

AponiaJS publishes twelve public packages to the npm registry. Use the live npm
badges and linked registry pages below as the source of truth for the latest
published version.

| Package                                                                                | Latest                                                                                                                        | Install                                                       |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`@aponiajs/common`](https://www.npmjs.com/package/@aponiajs/common)                   | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon)](https://www.npmjs.com/package/@aponiajs/common)                   | `bun add @aponiajs/common@beta`                               |
| [`@aponiajs/core`](https://www.npmjs.com/package/@aponiajs/core)                       | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcore)](https://www.npmjs.com/package/@aponiajs/core)                       | `bun add @aponiajs/core@beta`                                 |
| [`@aponiajs/platform-elysia`](https://www.npmjs.com/package/@aponiajs/platform-elysia) | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fplatform-elysia)](https://www.npmjs.com/package/@aponiajs/platform-elysia) | `bun add @aponiajs/platform-elysia@beta elysia@2.0.0-beta.19` |
| [`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli)                         | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli)](https://www.npmjs.com/package/@aponiajs/cli)                         | `bun add --global @aponiajs/cli@beta`                         |
| [`create-aponia`](https://www.npmjs.com/package/create-aponia)                         | [![npm](https://img.shields.io/npm/v/create-aponia)](https://www.npmjs.com/package/create-aponia)                             | `bun create aponia@beta <name>`                               |
| [`@aponiajs/devtools`](https://www.npmjs.com/package/@aponiajs/devtools)               | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fdevtools)](https://www.npmjs.com/package/@aponiajs/devtools)               | `bun add @aponiajs/devtools@beta`                             |
| [`@aponiajs/graphql`](https://www.npmjs.com/package/@aponiajs/graphql)                 | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fgraphql)](https://www.npmjs.com/package/@aponiajs/graphql)                 | `bun add @aponiajs/graphql@beta`                              |
| [`@aponiajs/cron`](https://www.npmjs.com/package/@aponiajs/cron)                       | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcron)](https://www.npmjs.com/package/@aponiajs/cron)                       | `bun add @aponiajs/cron@beta`                                 |
| [`@aponiajs/cors`](https://www.npmjs.com/package/@aponiajs/cors)                       | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcors)](https://www.npmjs.com/package/@aponiajs/cors)                       | `bun add @aponiajs/cors@beta`                                 |
| [`@aponiajs/testing`](https://www.npmjs.com/package/@aponiajs/testing)                 | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Ftesting)](https://www.npmjs.com/package/@aponiajs/testing)                 | `bun add --dev @aponiajs/testing@beta`                        |
| [`@aponiajs/openapi`](https://www.npmjs.com/package/@aponiajs/openapi)                 | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fopenapi)](https://www.npmjs.com/package/@aponiajs/openapi)                 | `bun add @aponiajs/openapi@beta`                              |
| [`@aponiajs/opentelemetry`](https://www.npmjs.com/package/@aponiajs/opentelemetry)     | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fopentelemetry)](https://www.npmjs.com/package/@aponiajs/opentelemetry)     | `bun add @aponiajs/opentelemetry@beta`                        |

The reserved `aponiajs` facade is private in this workspace and is not
published. Do not install it yet.

## Application packages

A decorated HTTP application normally imports `@aponiajs/common` and
`@aponiajs/platform-elysia`, with Elysia installed as the platform peer:

```bash
bun add @aponiajs/common@beta @aponiajs/platform-elysia@beta elysia@2.0.0-beta.19
```

```ts
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";

@Controller()
class AppController {
  @Get()
  hello(): string {
    return "Hello, AponiaJS!";
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(3000);
}

await bootstrap();
```

### `@aponiajs/common`

The platform-neutral public authoring API:

- module, controller, route, injection, and logging contracts;
- `@Module()`, `@Controller()`, `@Validation()`, HTTP method decorators,
  `@Injectable()`, `@Inject()`, and WebSocket gateway decorators;
- provider helpers and explicit injection tokens.

[Package README](../packages/common/README.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/common)

### `@aponiajs/core`

The module graph and dependency injection runtime. Most HTTP applications
receive it transitively through `@aponiajs/platform-elysia`; framework adapters
and standalone container integrations may install it directly.

[Package README](../packages/core/README.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/core)

### `@aponiajs/platform-elysia`

The Elysia adapter, application lifecycle, decorated route mapper, native
WebSocket gateway runtime, and native plugin escape hatch.
`AponiaFactory.createNative` exposes a statically composed module as the exact
Elysia application type for native tooling and Eden Treaty. `elysia` is a peer
dependency and must be installed by the application.

[Package README](../packages/platform-elysia/README.md) ·
[Eden Treaty](./eden-treaty.md) ·
[WebSockets](./websockets.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/platform-elysia)

### `@aponiajs/cron`

Declare scheduled jobs in a module, with the jobs read from a validated
configuration. The package is an adapter over
[`@elysia/cron`](https://www.npmjs.com/package/@elysia/cron), which wraps
[croner](https://github.com/hexagon/croner): AponiaJS contributes a module a
registration belongs in and a configuration the jobs are validated through, and
no scheduling engine of its own. It has no persistence, no retries, no
cross-process coordination, and no distributed lock — a cron expression in one
process runs in that process.

[Package README](../packages/cron/README.md) ·
[Authoring a plugin package](./plugin-packages.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/cron)

### `@aponiajs/cors`

Answer cross-origin requests for an application's routes, with the policy read
from a validated configuration. The package is an adapter over
[`@elysia/cors`](https://www.npmjs.com/package/@elysia/cors): AponiaJS
contributes a module a registration belongs in and a configuration the origins,
methods, headers, and credentials are validated through, and no CORS
implementation of its own. It is the smallest package in the set — a literal
policy needs no package at all — and it carries one boundary worth stating: an
origin that is a `RegExp` or a function is code rather than data, so it is not
expressible through a configuration and belongs with the raw plugin.

[Package README](../packages/cors/README.md) ·
[Authoring a plugin package](./plugin-packages.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/cors)

### `@aponiajs/graphql`

Serve a GraphQL endpoint for an application's queries, with the mount path read
from a validated configuration. The package is an adapter over
[`@elysia/graphql-yoga`](https://www.npmjs.com/package/@elysia/graphql-yoga),
which wraps Yoga: AponiaJS contributes a module the plugin is declared in and a
configuration the path is validated through, and no schema of its own. The
schema is the application's — `typeDefs` plus `resolvers`, or a prebuilt
`GraphQLSchema` — returned from an injected factory so resolvers close over
providers. The module sets both the plugin's `path` and yoga's `graphqlEndpoint`
from the one declared value, which is what makes a non-default endpoint answer
instead of returning `404`.

[Package README](../packages/graphql/README.md) ·
[Authoring a plugin package](./plugin-packages.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/graphql)

### `@aponiajs/testing`

Boot an application for a test with `createTestApplication`, replace one provider
for one boot, and tear the boot down without leaking a listener. It adds no test
runner and no mocking framework: every `test` and `expect` stays the runner's, and
`overrideProvider` replaces a provider's descriptor in the compiled module graph
rather than intercepting modules. A token no module in the graph provides is
refused at build time with `MISSING_PROVIDER`, and asserting a request needs no
socket — `application.handle(new Request(...))` reaches the real route table. The
one real port it can bind exists for the WebSocket case that needs one.

[Package README](../packages/testing/README.md) ·
[Testing applications](./testing.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/testing)

### `@aponiajs/openapi`

Serve an OpenAPI document for an application's own routes, with the document's
`title`, `version`, and `description` read from a validated configuration. The
package is an adapter over
[`@elysia/openapi`](https://www.npmjs.com/package/@elysia/openapi), which builds
the document from the route table Elysia compiled: AponiaJS contributes a module
the plugin is declared in and a configuration the metadata is validated through,
and no generator of its own. The document describes the routes; it does not
validate requests, generate clients, or serve any interface but the wrapped
plugin's.

[Package README](../packages/openapi/README.md) ·
[OpenAPI](./openapi.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/openapi)

### `@aponiajs/devtools`

The opt-in devtools surface for a running application: an HTTP API mounted on the
application's own route table under `/__devtools`, on the address the application
already answers, that reports the compiled graph,
the routes the application answers, the stages each route passes through, the log
stream, the requests that reached the record and what answered them, and
what a build decided about the project's invokers. It is a leaf package — nothing
in the framework depends on it — and it is enabled by an application's own
registration, never by an environment variable the framework reads to decide.
An application that declares its configuration does read one, through
`provideConfiguration`; that read is the application's, not the framework's.

[Package README](../packages/devtools/README.md) ·
[Devtools guide](./devtools.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/devtools)

### `@aponiajs/opentelemetry`

Trace an application's routes with OpenTelemetry, with the policy read from a
validated configuration. The package is an adapter over
[`@elysia/opentelemetry`](https://www.npmjs.com/package/@elysia/opentelemetry):
AponiaJS contributes a module the plugin is declared in and a configuration the
service name, body recording, header capture, and URL redaction are validated
through, and no tracing backend of its own. **It ships no exporter and no
instrumentation** — the span processors, the exporters, and the instrumentations
are the application's, passed to `register` because they are live objects a
configuration cannot carry. Its sharpest limit is the wrapped plugin's: the
plugin's `NodeSDK` is process-global, so the first registration in a process owns
it and every later one is inert, and `application.close()` does not stop it.

[Package README](../packages/opentelemetry/README.md) ·
[Authoring a plugin package](./plugin-packages.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/opentelemetry)

## Project creation and CLI

Install the published CLI globally with Bun and invoke its `aponia` binary
directly:

```bash
bun add --global @aponiajs/cli@beta
aponia new my-api
aponia --version
```

The global CLI and the separately published `create-aponia` entrypoint call the
same project generator. See the
[complete CLI guide](./cli.md), the
[`@aponiajs/cli` npm page](https://www.npmjs.com/package/@aponiajs/cli), and the
[`create-aponia` npm page](https://www.npmjs.com/package/create-aponia).

## Synchronized versions

All twelve public packages are released with the same
[Semantic Version](https://semver.org). Avoid mixing AponiaJS package versions
within one application. See [Releasing npm Packages](./releasing.md) for the
version gate and publication flow.
