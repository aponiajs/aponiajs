# Aponia CLI

## Design reference

The Aponia CLI follows the parts of the Nest CLI contract that fit a Bun-first
Elysia application:

- `new` is the standard application generator;
- `n` is its short alias;
- `--dry-run` and `-d` report changes without writing;
- `--skip-install` and `-s` create files without installing dependencies;
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

## Bun create

The `create-aponia` package delegates to the same tested generator:

```bash
bun create aponia my-api
bun create aponia my-api --skip-install
bun create aponia my-api --dry-run
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
created by `nest new`. Future generated resources belong directly under
`src/<resource>` and are then imported by `AppModule`; the CLI does not create
an artificial `src/modules/app` directory.

## Safety behavior

- Dry-run performs template discovery and name validation without writing.
- Existing target directories are never merged or overwritten.
- Template output is deterministic and sorted.
- Process arguments are passed to `Bun.spawn` as an array.
- Installation uses the Bun executable and inherits terminal streams.
- Installation failure returns a nonzero CLI result.

## Planned generator boundary

Nest supports many component schematics. Aponia will add these incrementally
after AST-safe module registration exists:

```text
aponia generate module <name>
aponia generate controller <name>
aponia generate service <name>
aponia generate resource <name>
```

The current CLI does not claim these commands yet. A resource generator must
atomically generate the module, controller, service, schemas, and tests, then
register the module without text-fragile source rewriting.
