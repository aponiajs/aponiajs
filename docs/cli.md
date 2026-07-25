# Aponia CLI

The CLI is published on npm as
[`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli). The matching
[`create-aponia`](https://www.npmjs.com/package/create-aponia) package provides
the `bun create` entrypoint.

## Install

Install the CLI globally with Bun, then invoke `aponia` directly:

```bash
bun add --global @aponiajs/cli
aponia --version
```

## Design reference

The Aponia CLI follows the parts of the Nest CLI contract that fit a Bun-first
Elysia application:

- `new` is the standard application generator;
- `n` is its short alias;
- `--dry-run` and `-d` report changes without writing;
- `--skip-install` and `-s` create files without installing dependencies;
- `generate` and `g` expose the complete built-in Nest schematic catalog;
- generated declarations are registered in the nearest module by default;
- generated projects use a canonical source root and a small bootstrap file;
- project metadata lives in `aponia.json`, analogous to the organizational role
  of `nest-cli.json`.

Official Nest references:

- <https://docs.nestjs.com/cli/overview>
- <https://docs.nestjs.com/cli/usages>
- <https://docs.nestjs.com/cli/workspaces>
- <https://docs.nestjs.com/first-steps>
- <https://docs.nestjs.com/modules>
- <https://docs.nestjs.com/controllers>

## Commands

```text
aponia new <name> [options]
aponia n <name> [options]
aponia generate <schematic> <name> [options]
aponia g <schematic> <name> [options]
aponia help
aponia version
```

Project names must use lowercase kebab-case:

```text
users-api
commerce-service
internal-tools
```

The generator refuses to overwrite an existing target directory.

## Generate

The published `@aponiajs/cli` package supports every built-in schematic listed
by the Nest CLI command reference:

| Schematic     | Alias | Output                |
| ------------- | ----- | --------------------- |
| `app`         | —     | workspace application |
| `library`     | `lib` | workspace library     |
| `class`       | `cl`  | plain class           |
| `controller`  | `co`  | HTTP controller       |
| `decorator`   | `d`   | custom decorator      |
| `filter`      | `f`   | exception filter      |
| `gateway`     | `ga`  | WebSocket gateway     |
| `guard`       | `gu`  | request guard         |
| `interface`   | `itf` | TypeScript interface  |
| `interceptor` | `itc` | request interceptor   |
| `middleware`  | `mi`  | middleware            |
| `module`      | `mo`  | Aponia module         |
| `pipe`        | `pi`  | transformation pipe   |
| `provider`    | `pr`  | injectable provider   |
| `resolver`    | `r`   | GraphQL resolver      |
| `resource`    | `res` | complete resource     |
| `service`     | `s`   | injectable service    |

`router`, `routers`, and `route` are convenience aliases for `controller`, since
Aponia controllers own the Elysia route declarations.

```bash
aponia g module users
aponia g controller users
aponia g service users
aponia g router health --no-spec
aponia g resource users --type rest
```

Component options follow Nest conventions:

```text
--dry-run, -d
--flat / --no-flat
--spec / --no-spec
--skip-import
--module <name>
--project, -p <name>
--path <path>
```

Resources additionally support `--crud` / `--no-crud` and these transports:
`rest`, `graphql-code-first`, `graphql-schema-first`, `microservice`, and `ws`.
REST resources generate a controller; GraphQL resources generate a resolver;
WebSocket resources generate a gateway.

CLI flags override project-specific `generateOptions`, which override global
`generateOptions` in `aponia.json`. Both `spec` and `flat` defaults are
supported. `spec` may be a boolean or a map keyed by schematic name.

Controllers are added to `controllers`, services and providers to `providers`,
and modules and resources to `imports`. Use `--skip-import` to create files
without changing a module, or `--module <name>` to select the declaring module.
The update is computed before any file is written, and the generator refuses to
overwrite an existing file.

## Create an application

```bash
aponia new my-api
aponia new my-api --skip-install
aponia new my-api --dry-run
```

## Generated project

```text
my-api/
|-- .env.example
|-- .gitignore
|-- aponia.json
|-- package.json
|-- README.md
|-- tsconfig.json
|-- vite.config.ts
|-- src/
|   |-- app.controller.spec.ts
|   |-- app.controller.ts
|   |-- app.module.ts
|   |-- app.service.ts
|   `-- main.ts
`-- test/
    `-- app.e2e-spec.ts
```

The generated runtime flow is:

```text
main.ts
  -> AponiaFactory.create(AppModule)
  -> AppModule
  -> AppController
  -> AppService
```

`main.ts` owns only bootstrap configuration and `listen`. Decorated controllers
own routes. Services own application behavior. Generated application code does
not import Elysia or low-level runtime descriptors.

This is standard mode and intentionally matches the flat starter structure
created by `nest new`. Generated resources belong directly under
`src/<resource>` and are imported by `AppModule`; the CLI does not create an
artificial `src/modules/app` directory.

## Safety behavior

- Dry-run performs template discovery and name validation without writing.
- Existing target directories are never merged or overwritten.
- Template output is deterministic and sorted.
- Process arguments are passed to `Bun.spawn` as an array.
- Installation uses the Bun executable and inherits terminal streams.
- Installation failure returns a nonzero CLI result.

See the [published package catalog](./packages.md) for all AponiaJS npm
packages.
