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
lowered. A declared route states the validator its `@Validation()` model was
declared with rather than the model class, and a declared gateway states its
path, handlers, and server properties as a `defineElysiaWebSocketGateway` plan,
so booting from the descriptor module reads no decorator metadata for either.
Both cover what they can prove and report what they cannot, so an
application chooses how far to go: pass `controllerInvokerArtifact` and
`moduleDescriptorArtifact` to `AponiaFactory.create` while still naming its root
module class, or ignore both files and keep booting exactly as before. Each file
records the framework release it was built against, and the runtime refuses one
from another release — and a descriptor module that holds no declaration for the
module the application names. A refusal is not an error: the application lowers
its decorated classes and compiles its own route bindings instead, so it costs a
cold start and never a wrong answer. A release-stamped artifact is adopted whole,
with no freshness check, so `aponia build` has to run again after the module
graph or a handler changes. What
it writes is laid out by the formatter your project already uses when it has one,
and by the `oxfmt` this package depends on at an exact version when it does not,
so both modules are committed application source a `vp check` accepts rather
than build output to hide from it.

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
build when generation fails. A project created by `aponia new` ships that script
as `scripts/build.ts`, and both generated modules are committed, so a freshly
generated application passes `controllerInvokerArtifact` and
`moduleDescriptorArtifact` to `AponiaFactory.create` from its own `src/main.ts`,
serves through generated invokers, and boots from the declared module graph
before any build has run. `bun run build` then refreshes them rather than
creating them. Registering it is opt-in for an application you already have, and
`aponia build`
still generates without bundling.

The generate command supports the Aponia schematic catalog: application,
library, class, controller, decorator, filter, gateway, guard, interface,
interceptor, module, provider, resolver, resource, and service. Nest aliases are
supported, and `router`, `routers`, and `route` map to Aponia controllers.
Nest's `middleware` and `pipe` schematics are deliberately absent: the framework
has neither concept, native Elysia plugins are the middleware mechanism, and
route validation covers transformation, so a generator would emit a file nothing
consumes.

Generated controllers, providers, services, modules, resources, gateways,
guards, interceptors, and filters are registered in the nearest Aponia module
unless `--skip-import` is used: controllers under `controllers`, enhancers and
gateways under `providers`, and modules under `imports`.
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
