# 02 · Install and generate

**Use when:** starting a new application, or adding AponiaJS to an existing Bun
project.

## A new application

```bash
bun add --global @aponiajs/cli@alpha
aponia new my-api
cd my-api
bun run dev
```

`bun create aponia@alpha my-api` reaches the same generator without a global
install.

## An existing project

```bash
bun add @aponiajs/common@alpha @aponiajs/platform-elysia@alpha elysia@2.0.0-rc.4
```

Every public package shares one version, and the channel a release goes to is
derived from that version: a prerelease publishes under the tag its identifier
names — `alpha`, `beta`, `rc`, or `canary` — and never under `latest`. The
published line is on the alpha channel, so the `@alpha` tag is what to install
today; the workspace targets `1.0.0-beta.N`, which publishes under `beta` once
that line ships.
`elysia` is an exact peer of `@aponiajs/platform-elysia`, so it is pinned rather
than left to resolve the latest release.

## What the generator writes

`aponia new` follows Nest's flat starter layout: `src/app.module.ts` composes the
application, `src/main.ts` bootstraps it, and one controller and one service sit
beside them with the controller's spec. Its `src/config.ts` declares the
application's configuration — one `PORT` schema validated once at boot and read
back through `application.get(AppConfig)`, which the
[configuration guide](../configuration.md) covers. The starter writes more than
those — its own `src/logger.ts`, the generated `src/descriptors.generated.ts` and
`src/invokers.generated.ts`, and the files around them. [The CLI
reference](../cli.md) prints the complete tree.

Later resources get their own directory:

```bash
aponia generate module users
aponia generate resource users --type rest

aponia g mo users
aponia g res users
```

A REST resource also writes `users.model.ts`, which owns separate
`@Validation()` classes for create input, partial update input, and shared path
parameters. The controller and service use those classes directly.

Next: [03 · Modules](./03-modules.md) · Deep dive: [CLI reference](../cli.md)
