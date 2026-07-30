# 01 · Overview

**Use when:** you are meeting AponiaJS for the first time, or deciding whether a
change belongs in the decorator layer or the runtime.

AponiaJS is a Nest-shaped application framework for Bun that compiles down to
plain Elysia. You write modules, controllers, and services; the framework
validates the dependency graph before the server listens and mounts every
controller as a native Elysia plugin.

## Two authoring layers

Decorators are a thin metadata surface. The runtime consumes immutable
descriptors.

```text
@Module / @Controller / @Get      -> reflect-metadata entries
compileRootModule                 -> frozen ModuleDefinition / ControllerDefinition / Provider
createContainer + compileModuleGraph -> validated graph, singleton container
AponiaFactory.create              -> a running Elysia application
```

`@aponiajs/common` holds the decorators and contracts, `@aponiajs/core` holds the
graph and container and never sees a decorator, and `@aponiajs/platform-elysia`
lowers one into the other. Dependencies run one way:
`common ← core ← platform-elysia`.

Descriptors are also a public API. An application can call `defineModule`,
`elysiaController`, and the `provide*` helpers and skip decorators entirely.
The concise controller callback keeps native Elysia request inference without a
manual context type or `typeof`. `defineElysiaController` remains the advanced
descriptor form. Both paths stay supported.

## What exists today

Implemented: decorated modules and HTTP controllers, one-schema validation
models over Standard Schema and native validators, request parameter decorators,
singleton dependency injection,
class/value/factory/alias providers, explicit tokens, module imports and
exports, lifecycle, structured logging, generators, and native Elysia escape
hatches, RFC 9457 application errors for every supported HTTP error status, and
provider-registered WebSocket gateways backed by native Elysia sockets.

Not implemented yet: guards, interceptors, middleware, exception filters,
automatic mapping of native framework and validation errors to Problem Details,
non-singleton scopes, testing modules, OpenAPI, authentication, production
WebSocket policies and transport extraction, and microservice transports. The
implemented WebSocket gateway preview does not yet include the planned
transport-neutral adapter, handshake policies, or per-message schema layer.
Check
[`ROADMAP.md`](../../ROADMAP.md) before assuming a feature exists.

Every chapter that follows has a runnable counterpart in
[`examples/`](../../examples/README.md): one application per topic, each with
end-to-end tests asserting what the chapter describes.

Next: [02 · Install and generate](./02-install-and-generate.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
