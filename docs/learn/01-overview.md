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
`defineElysiaController`, and the `provide*` helpers and skip decorators
entirely. Both paths stay supported.

## What exists today

Implemented: decorated modules and HTTP controllers, Standard Schema route
validation, request parameter decorators, singleton dependency injection,
class/value/factory/alias providers, explicit tokens, module imports and
exports, lifecycle, structured logging, generators, and native Elysia escape
hatches.

Not implemented yet: guards, interceptors, middleware, exception filters,
Problem Details errors, non-singleton scopes, testing modules, OpenAPI,
authentication, WebSockets, microservice transports. Check
[`ROADMAP.md`](../../ROADMAP.md) before assuming a feature exists.

Every chapter that follows has a runnable counterpart in
[`examples/feature-tour`](../../examples/feature-tour/README.md), which maps each
use case to the file that demonstrates it.

Next: [02 · Install and generate](./02-install-and-generate.md) ·
Deep dive: [architecture and style](../architecture-and-style.md)
