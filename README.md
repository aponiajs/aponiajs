<div align="center">

<img src="./assets/aponia-flower.svg" alt="A small lavender AponiaJS flower" width="88" height="88" />

# AponiaJS

**A structured TypeScript framework for Bun and Elysia.**

Create an application, add a feature, and keep its architecture clear as it grows.

[![CI](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml/badge.svg)](https://github.com/aponiajs/aponiajs/actions/workflows/ci.yml)
[![CLI on npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli/alpha?label=CLI%20%28alpha%29&color=c3a7dc)](https://www.npmjs.com/package/@aponiajs/cli)
[![Bun](https://img.shields.io/badge/Bun-1.4.2-f8eddd?logo=bun&logoColor=24232d)](https://bun.sh)
[![MIT License](https://img.shields.io/badge/license-MIT-f3d5de)](./LICENSE)

[Quick start](#quick-start) · [CLI commands](#cli-commands) · [Documentation](#documentation) · [Examples](./examples/README.md)

<sub>Currently in alpha. AponiaJS is not recommended for production use yet.</sub>

</div>

## Quick start

Install [Bun](https://bun.sh), then use the CLI to create an application and add
a REST resource:

```bash
bun add --global @aponiajs/cli
aponia new my-api
cd my-api
aponia generate resource users --type rest
aponia build
bun run dev
```

`aponia generate` writes the resource and registers it in `AppModule`, and
`aponia build` refreshes the route invokers and module descriptors the
application boots from. Without that refresh the generated routes are not
mounted, because the committed descriptors are the whole module graph.

The application starts at `http://localhost:3000`. In another terminal, try
the generated routes:

```bash
curl http://localhost:3000/users
curl -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada"}'
```

`GET /users` starts with an empty collection. `POST /users` creates an item
with an ID. The generated service stores data in memory, so the collection
resets when the application restarts.

The starter also serves `GET /` and mounts the development tools under
`/__devtools`: [`GET /__devtools/meta`](http://localhost:3000/__devtools/meta)
reports the contract version, framework release, and artifacts its boot adopted.
You can create the same starter with `bun create aponia my-api`.

## What the CLI creates

`aponia new` prepares a Bun application, installs its dependencies, and adds
configuration, tests, and build scripts. The REST resource command creates a
feature under `src/users/` and registers its module in `AppModule`.

| File                                | Responsibility                      |
| ----------------------------------- | ----------------------------------- |
| `src/users/users.controller.ts`     | HTTP routes and request handling    |
| `src/users/users.service.ts`        | Application behavior                |
| `src/users/users.model.ts`          | Create, update, and path validation |
| `src/users/users.module.ts`         | Feature registration                |
| `src/users/entities/user.entity.ts` | Resource entity                     |

The resource also includes controller and service tests. Its generated files
are ordinary application code that you can adapt to your domain.

## CLI commands

| Command                          | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `aponia new my-api`              | Create an application and install dependencies.          |
| `aponia g res users --type rest` | Generate a REST resource with CRUD routes.               |
| `aponia g module billing`        | Add a module.                                            |
| `aponia g controller billing`    | Add an HTTP controller.                                  |
| `aponia g service billing`       | Add an injectable service.                               |
| `aponia g gateway events`        | Add a WebSocket gateway provider.                        |
| `aponia build`                   | Refresh generated route invokers and module descriptors. |
| `aponia --help`                  | List commands and options.                               |

`g` is short for `generate`. The CLI registers generated components in the
nearest module by default. Use `--module <name>` to select a module, or
`--skip-import` to handle registration yourself. Add `--no-spec` to skip
generated tests.

Use `--dry-run` to preview `new`, `generate`, or `build` without writing
files. `aponia new my-api --skip-install` creates the project without running
`bun install`. The [complete CLI guide](./docs/cli.md) covers every schematic,
alias, option, and supported resource transport. GraphQL and microservice
commands currently generate scaffolds; their runtimes are outside this release.

## Work with a generated application

The starter includes these scripts:

```bash
bun run dev       # run with file watching
bun test          # run unit tests
bun run test:e2e  # run the starter end-to-end test
bun run check     # format, lint, and type-check
bun run build     # refresh generated code and bundle
```

`bun run build` refreshes the starter's committed route invoker and module
descriptor files before bundling; `aponia build` refreshes the same two files
without bundling. `bun run dev` serves the routes those files describe, so run
one of them after generating a resource — otherwise its routes are not mounted.

## Framework capabilities

- **Modules and dependency injection** organize controllers and providers by
  feature, with explicit exports between modules.
- **Decorated HTTP routes** keep request handling in controllers and application
  behavior in services.
- **Route validation** accepts Elysia validators and
  [Standard Schema](https://standardschema.dev) implementations.
- **Native Elysia access** supports plugins and routes alongside Aponia's
  decorators and explicit descriptors.

## Documentation

Follow the [learning path](./docs/learn/README.md) for a guided introduction.
For specific topics, see the [CLI guide](./docs/cli.md),
[dependency injection](./docs/dependency-injection.md),
[validation](./docs/learn/06-validation.md), [WebSockets](./docs/websockets.md),
and [native plugins](./docs/native-plugins.md). The
[package catalog](./docs/packages.md) describes the published packages.

## Run the CLI from this checkout

To try local CLI changes, invoke its Bun entrypoint directly. From the
repository root (assuming the checkout directory is named `aponiajs`):

```bash
bun install
bun packages/cli/bin/aponia.ts --help
bun packages/cli/bin/aponia.ts new my-api --dry-run
cd ..
bun ./aponiajs/packages/cli/bin/aponia.ts new my-api
cd my-api
bun ../aponiajs/packages/cli/bin/aponia.ts g res users --type rest
bun run dev
```

The dry run previews the files. The next command creates an application beside
the framework checkout. Its dependencies use the version in this checkout, so
that version must be available from the package registry for the default
installation to finish.

## Contributing

This repository contains the framework packages and CLI. Start with the
[repository guide](./AGENTS.md) and [release guide](./docs/releasing.md). Run
`bun run check`, `bun run test:coverage`, and `bun run test:vite-plus`
before submitting changes.

## License

AponiaJS is available under the [MIT License](./LICENSE).
