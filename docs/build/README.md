# Build

Application structure, the module graph, and the runtime pieces every AponiaJS
application composes. Read this category when designing a module boundary,
choosing where a provider belongs, or wiring a lifecycle, configuration, or
testing concern.

## When to read what

| Page                                                  | Answers                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Architecture and style](./architecture-and-style.md) | How an application and the framework are laid out, named, and reviewed       |
| [Dependency injection](./dependency-injection.md)     | Tokens, visibility, providers, and the error codes raised on failure         |
| [Configuration](./configuration.md)                   | Declaring configuration, validating it once at boot, and injecting the value |
| [Lifecycle](./lifecycle.md)                           | The five provider hooks, shutdown, and the readiness and liveness probes     |
| [Request context](./request-context.md)               | Per-request async local storage, request identifiers, and injectable context |
| [Execution enhancers](./enhancers.md)                 | Guards, interceptors, and exception filters on a route's hooks               |
| [Logging](./logging.md)                               | Logger configuration and the bootstrap log lines                             |
| [Testing an application](./testing.md)                | Exercising a real application through `application.handle` and the test kit  |
| [Compiler invariants](./invariants.md)                | Scoped lifetimes, borrow views, typestate, and linear consumption            |
| [Files](./files.md)                                   | Uploaded files, named downloads, and serving static assets                   |
| [Views and HTML templates](./views.md)                | Blade layouts, sections, components, props, and shared data                  |
| [Migrating from NestJS](./migrating-from-nest.md)     | The package, authoring, validation, error, and CLI mapping from NestJS       |

## Start here

Read [Architecture and style](./architecture-and-style.md) first, then
[dependency injection](./dependency-injection.md). The remaining pages follow
the capability an application is adding.

Return to the [documentation index](../README.md).
