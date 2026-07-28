# 02 · Install and generate

**Use when:** starting a new application, or adding AponiaJS to an existing Bun
project.

## A new application

```bash
bun add --global @aponiajs/cli
aponia new my-api
cd my-api
bun run dev
```

`bun create aponia my-api` reaches the same generator without a global install.

## An existing project

```bash
bun add @aponiajs/common@alpha @aponiajs/platform-elysia@alpha elysia
```

Every public package shares one version and is published to the `alpha` channel.
`latest` is reserved for the first stable release, so the `@alpha` tag is
required today.

## What the generator writes

`aponia new` follows Nest's flat starter layout:

```text
src/
|-- app.controller.spec.ts
|-- app.controller.ts
|-- app.module.ts
|-- app.service.ts
`-- main.ts
test/
`-- app.e2e-spec.ts
```

Later resources get their own directory:

```bash
aponia generate module users
aponia generate resource users --type rest

aponia g mo users
aponia g res users
```

A REST resource also writes `users.schema.ts`, which owns the route schemas the
controller passes to its decorators and from which both DTOs derive their types.

Next: [03 · Modules](./03-modules.md) · Deep dive: [CLI reference](../cli.md)
