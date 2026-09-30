# Published Packages

AponiaJS publishes six public packages to the npm registry. Use the live npm
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

All six public packages are released with the same
[Semantic Version](https://semver.org). Avoid mixing AponiaJS package versions
within one application. See [Releasing npm Packages](./releasing.md) for the
version gate and publication flow.
