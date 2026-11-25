# {{PROJECT_NAME}} — agent guide

`CLAUDE.md` and `GEMINI.md` are symlinks to this file.

This is an AponiaJS application: Nest-style modules, controllers, and dependency
injection running on Bun, with Elysia as the HTTP layer.

The framework packages are `@aponiajs/common` (decorators and contracts),
`@aponiajs/core` (module graph and DI container), and
`@aponiajs/platform-elysia` (bootstrap, HTTP routes, WebSocket gateways).

## Commands

```bash
bun run dev        # start with watch mode
bun start          # start once
bun test           # unit tests
bun run test:e2e   # end-to-end tests through application.handle
bun run build      # bundle into dist, regenerating the generated modules first
bun run inspect    # print the module graph, providers, routes, and gateways
bun run check      # format, lint, and type-check
```

`bun run inspect --json` prints the same inspection as JSON. It compiles the
module graph without starting the server or constructing any provider, so it is
safe to run at any time and is the fastest way to see what the application
actually mounts.

Install the CLI once with `bun add --global @aponiajs/cli`, then use `aponia
generate` to add code. It renders the files, registers the new declaration in
the nearest module, and keeps names consistent:

```bash
aponia generate resource users           # module, controller, service, and model
aponia generate resource chat --type ws  # provider-registered WebSocket gateway
aponia generate controller health --no-spec
aponia generate service users
aponia generate module billing
```

`--dry-run` reports the changes without writing anything. Prefer the generator
over hand-written files so imports, suffixes, and module registration match the
rest of the project.

## Layout

The starter is flat, and `aponia new` reproduces it exactly:

```text
scripts/
|-- build.ts
`-- inspect.ts
src/
|-- app.controller.spec.ts
|-- app.controller.ts
|-- app.module.ts
|-- app.service.ts
|-- config.ts
|-- descriptors.generated.ts
|-- invokers.generated.ts
|-- logger.ts
`-- main.ts
test/
`-- app.e2e-spec.ts
```

`src/config.ts` holds the application's configuration: one schema that validates
`PORT` once at boot, provided by `AppModule` and read back through
`application.get(AppConfig)` in `src/main.ts`.

Every later feature is a directory under `src/<resource>/`, holding its module,
controller, service, models, and tests together.

`src/invokers.generated.ts` and `src/descriptors.generated.ts` sit beside those
sources and are committed. `bun run build` regenerates both in place, which is why
a controller or a module change is not live in them until the next build.
`src/main.ts` imports neither: a `bunfig.toml` preload registers the platform's
in-memory compiler, so `bun run dev`, `bun start`, and `bun test` lower the
decorated graph and compile their routes without a build having run.
`scripts/inspect.ts` is what reads the descriptor artifact.

That artifact holds no declaration for `AppModule` in this starter, because
`src/app.module.ts` imports the `DevtoolsModule.forRoot(...)` call `aponia build`
cannot lower. The inspection therefore reports the decorated graph rather than a
declared one, and it still lists `DevtoolsModule` because the registration is in
the graph. Both files are stamped with the framework release that wrote them, and the
inspection refuses one from another release rather than using it, which costs the
optimization and never a wrong answer. `aponia build` writes the same two modules
without bundling.

## Devtools

This starter imports `@aponiajs/devtools` in `src/app.module.ts` through
`DevtoolsModule.forRoot(...)`, so the devtools surface is a module in the graph:
its API is a controller, its request record is a `RequestLifecycleHook`, and
`bun run inspect` lists it beside the application's own module.

That placement has one cost. `aponia build` lowers an `imports` entry only when
it is a single identifier naming a declaration read from the project's own
source, and `DevtoolsModule.forRoot(...)` returns a `DynamicModule` rather than
such a declaration, so the build declines the root module and
`src/descriptors.generated.ts` carries an empty module record. The inspection
that hands that artifact over therefore reports the decorated graph instead of a
declared one. Nothing is missing: the decorated graph still mounts the devtools
controller and its hook, and the surface answers as it does at run time. Carrying
the registration in the graph is the trade this starter makes, and it is why the
descriptor artifact is deliberately empty.

`src/logger.ts` holds the application's logger. `src/main.ts` hands it to
`AponiaFactory.create` and `src/app.module.ts` hands the same object to
`DevtoolsModule.forRoot`, which is the half the devtools needs from the
application: the registration patches the logger it is given in place rather
than replacing it, so the lines the boot writes about itself are what
`/__devtools/logs` serves. Hand it to one and not the other and the stream is
missing exactly what the other wrote.

The surface is served only when `APONIA_DEVTOOLS=true`, on the application's own
port under `/__devtools` — it is part of the route table the application mounts,
and an application route that claims a devtools path wins it, because the more
specific route answers: a static or parameter route beats this wildcard whether
it is mounted before or after the devtools controller. It is reachable
wherever the application is, and `/requests` records headers and bodies with no
warning: this is a development surface, and `enabled` is how an application keeps
it out of production. `enabled: false` mounts nothing at all: no route and no
endpoint. The expression in `src/app.module.ts` is this starter's choice; the
framework never reads the environment to choose its own behaviour. This
application reads it where it declares it to: `src/config.ts` declares the
`PORT` schema, and the `provideConfiguration(AppConfig)` provider in
`src/app.module.ts` validates it once at boot — that read is the application's.
The trade is stated in the
[devtools guide](https://github.com/aponiajs/aponiajs/blob/main/docs/services/devtools.md).

## Authoring rules

- `src/app.module.ts` is the root module. Feature modules go in its `imports`.
  A module's `providers` stay private to that module until they are listed in
  its `exports`.
- Controllers declare routes with `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`,
  `@Head`, and `@Options`. Read request input through parameter decorators —
  `@Body`, `@Query`, `@Param`, `@Headers`, `@Cookie`, `@State`, `@Req`,
  `@ResponseSettings`, and `@HttpStatus` — rather than reaching into the raw
  request.
- Validation is one schema per class. A REST CRUD resource generates
  `<name>.model.ts` with separate create, update, and path-parameter classes;
  pass those classes to the route decorator instead of combining schemas inline.
- Controllers delegate to injectable services. Keep HTTP concerns in the
  controller and business behavior in the service.
- A provider is a singleton per module: one `@Injectable()` class is
  instantiated once for each module that declares it, and once more for each
  module that declares it separately.
- Import framework packages by their package name. Local imports use explicit
  `.ts` extensions.
- Application failures return `HttpError` from `@aponiajs/platform-elysia`,
  which serializes as RFC 9457 `application/problem+json` without exposing a
  stack or cause.

## Testing

Build the application with `AponiaFactory.create` and assert through
`application.handle(new Request(...))`. That exercises the real route,
validation, and injection path without binding a port.

```ts
const application = await AponiaFactory.create(AppModule, { logger: false });
const response = await application.handle(new Request("http://localhost/"));

expect(response.status).toBe(200);
await application.close();
```

Pass `{ logger: false }` in tests so bootstrap does not print its route table.

## Reference

[`llms.txt`](./llms.txt) indexes the framework documentation and published
packages.
