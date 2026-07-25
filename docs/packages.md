# Published Packages

AponiaJS publishes five public packages to the npm registry. Use the live npm
badges and linked registry pages below as the source of truth for the latest
published version.

| Package                                                                                | Latest                                                                                                                        | Install                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`@aponiajs/common`](https://www.npmjs.com/package/@aponiajs/common)                   | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon)](https://www.npmjs.com/package/@aponiajs/common)                   | `bun add @aponiajs/common`                 |
| [`@aponiajs/core`](https://www.npmjs.com/package/@aponiajs/core)                       | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcore)](https://www.npmjs.com/package/@aponiajs/core)                       | `bun add @aponiajs/core`                   |
| [`@aponiajs/platform-elysia`](https://www.npmjs.com/package/@aponiajs/platform-elysia) | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fplatform-elysia)](https://www.npmjs.com/package/@aponiajs/platform-elysia) | `bun add @aponiajs/platform-elysia elysia` |
| [`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli)                         | [![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli)](https://www.npmjs.com/package/@aponiajs/cli)                         | `bun add --global @aponiajs/cli`           |
| [`create-aponia`](https://www.npmjs.com/package/create-aponia)                         | [![npm](https://img.shields.io/npm/v/create-aponia)](https://www.npmjs.com/package/create-aponia)                             | `bun create aponia <name>`                 |

The reserved `aponiajs` facade is private in this workspace and is not
published. Do not install it yet.

## Application packages

A decorated HTTP application normally imports `@aponiajs/common` and
`@aponiajs/platform-elysia`, with Elysia installed as the platform peer:

```bash
bun add @aponiajs/common @aponiajs/platform-elysia elysia
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

const application = await AponiaFactory.create(AppModule);
await application.listen(3000);
```

### `@aponiajs/common`

The platform-neutral public authoring API:

- module, controller, route, injection, and logging contracts;
- `@Module()`, `@Controller()`, HTTP method decorators, `@Injectable()`, and
  `@Inject()`;
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

The Elysia adapter, application lifecycle, decorated route mapper, and native
plugin escape hatch. `elysia` is a peer dependency and must be installed by the
application.

[Package README](../packages/platform-elysia/README.md) ·
[npm](https://www.npmjs.com/package/@aponiajs/platform-elysia)

## Project creation and CLI

Install the published CLI globally with Bun and invoke its `aponia` binary
directly:

```bash
bun add --global @aponiajs/cli
aponia new my-api
aponia --version
```

The global CLI and the separately published `create-aponia` entrypoint call the
same project generator. See the
[complete CLI guide](./cli.md), the
[`@aponiajs/cli` npm page](https://www.npmjs.com/package/@aponiajs/cli), and the
[`create-aponia` npm page](https://www.npmjs.com/package/create-aponia).

## Synchronized versions

All five public packages are released with the same
[Semantic Version](https://semver.org). Avoid mixing AponiaJS package versions
within one application. See [Releasing npm Packages](./releasing.md) for the
version gate and publication flow.
