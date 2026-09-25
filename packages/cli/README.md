# @aponiajs/cli

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcli)](https://www.npmjs.com/package/@aponiajs/cli)

The Bun-native Aponia command-line interface.

## Install

```bash
bun add --global @aponiajs/cli
```

## Commands

```bash
aponia new my-api
aponia n my-api --dry-run
aponia new my-api --skip-install
aponia generate controller users
aponia g s users
aponia g resource users --type rest
aponia g router health --no-spec
aponia build
aponia --version
```

The build command generates code from an application's own source. It parses
every file under the configured source root and writes two modules beside it:
`invokers.generated.ts`, which holds the route invokers the runtime would
otherwise compile at startup, and `descriptors.generated.ts`, which declares the
module graph as data so the application can boot without its decorators being
lowered. Both cover what they can prove and report what they cannot, so an
application chooses how far to go: pass the invoker artifact to
`AponiaFactory.create`, boot from `moduleDescriptors.<Module>`, or ignore both
files and keep booting exactly as before.

The same generation is available as a Bun plugin, so a bundle cannot serve a
stale artifact:

```ts
// scripts/build.ts
import { aponiaBuildPlugin } from "@aponiajs/cli";

const result = await Bun.build({
  entrypoints: ["./src/main.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [aponiaBuildPlugin()],
});
if (!result.success) process.exit(1);
```

It runs both generators in Bun's `onStart` hook — before the bundler resolves
anything — prints the same change lines `aponia build` prints, and fails the
build when generation fails. Registering it is opt-in, and `aponia build` still
generates without bundling.

The generate command supports the complete built-in Nest schematic catalog:
application, library, class, controller, decorator, filter, gateway, guard,
interface, interceptor, middleware, module, pipe, provider, resolver, resource,
and service. Nest aliases are supported, and `router`, `routers`, and `route`
map to Aponia controllers.

Generated controllers, providers, services, modules, and resources are
registered in the nearest Aponia module unless `--skip-import` is used.
Resource transports include REST, GraphQL code-first, GraphQL schema-first,
microservices, and WebSockets. Gateway schematics emit
`@WebSocketGateway("/<resource>")`; CRUD WebSocket resources also emit
`@SubscribeMessage()` handlers for create, read, update, and remove events with
`@MessageBody()` input binding.

A REST CRUD resource also generates `<name>.model.ts` with separate validated
classes for create bodies, update bodies, and path parameters. Controllers use
those classes directly in route decorators and parameter annotations, while
services share the create and update types. REST CRUD resources do not generate
DTO files; other transports retain their DTO or input scaffolds.

The separately published
[`create-aponia`](https://www.npmjs.com/package/create-aponia) package delegates
to the same generator. The documented CLI workflow uses the globally installed
`aponia` command consistently.

[npm package](https://www.npmjs.com/package/@aponiajs/cli) ·
[complete CLI guide](../../docs/cli.md) ·
[complete package catalog](../../docs/packages.md)
