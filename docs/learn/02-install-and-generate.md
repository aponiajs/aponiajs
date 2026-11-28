# 02 · Install and generate

**Use when:** starting a new application or adding AponiaJS to an existing Bun project.

## New application

```bash
bun add --global @aponiajs/cli
aponia new my-api
cd my-api
bun run dev
```

`bun create aponia my-api` uses the same generator without a global install.

## Existing project

```bash
bun add @aponiajs/common @aponiajs/platform-elysia elysia@2.0.0-rc.4
```

Every public package shares one synchronized `1.0.0` (`latest`) version. `elysia` is an exact peer and must be pinned.

## Generated layout

`aponia new` writes Nest's flat starter layout:

```text
src/
  app.module.ts
  main.ts
  app.controller.ts
  app.service.ts
  app.controller.spec.ts
  config.ts
```

`config.ts` declares configuration once. Read it back through `application.get(AppConfig)`.

Generate later resources into their own directory:

```bash
aponia generate module users
aponia generate resource users --type rest

aponia g mo users
aponia g res users
```

A REST resource also writes `users.model.ts` with separate `@Validation()` classes for create input, partial update input, and path parameters.

Next: [03 · Modules](./03-modules.md) · Deep dive: [CLI reference](../tooling/cli.md)
