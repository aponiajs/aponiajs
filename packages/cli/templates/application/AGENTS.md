# {{PROJECT_NAME}} — agent guide

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
|-- descriptors.generated.ts
|-- invokers.generated.ts
|-- logger.ts
`-- main.ts
test/
`-- app.e2e-spec.ts
```

Every later feature is a directory under `src/<resource>/`, holding its module,
controller, service, models, and tests together.

`src/invokers.generated.ts` and `src/descriptors.generated.ts` sit beside those
sources and are committed. `src/main.ts` passes `controllerInvokerArtifact` and
`moduleDescriptorArtifact` to `AponiaFactory.create` while still naming the
decorated `AppModule`, so the application serves through generated route
invokers and boots from the declared module graph from `bun run dev`,
`bun start`, and `bun test` without a build having run. `bun run build`
regenerates both in place, which is why a controller or a module change is not
live in the generated artifacts until the next build.

Both modules are stamped with the framework release that wrote them, and each is
refused rather than used when that release is not the one running. The startup
log says which graph answered, under `RoutesResolver`:

```text
[RoutesResolver] Booting AppModule from the generated module descriptors, so the declared graph serves this application.
```

A mismatch is slower but never wrong — the runtime compiles every route from
decorator metadata and lowers the module graph from its decorators instead — and
it is the only cost: nothing needs repairing by hand. The same applies to a
descriptor module left behind by a module rename, because the renamed root has no
entry and the decorated graph answers. `aponia build` writes the same two modules
without bundling.

## Devtools

This starter does not register `@aponiajs/devtools`, and that is a decision
rather than an omission. Registering it means importing a _dynamic_ module, and
`aponia build` lowers a module only when every `imports` entry is a single
identifier: the module that declares the registration is reported as `DECLINED`.
Here that module is the root and the only module a build can declare, so no
`descriptors.generated.ts` is written either, and the committed one keeps
serving the graph it already held — a graph this starter built without a
registration in it. Mounting the devtools therefore means giving up the
declared-graph boot, and that is the application's decision, not the starter's.

`src/logger.ts` holds the application's logger and `src/main.ts` hands it to
`AponiaFactory.create`, which is the half the devtools needs from the
application: a registration handed the same object patches it in place rather
than replacing it, so the lines the boot writes about itself are what
`/__devtools/logs` serves. Hand it to one and not the other and the stream is
missing exactly what the other wrote. Both halves of the trade are in the
[devtools guide](https://github.com/aponiajs/aponiajs/blob/main/docs/devtools.md).

## Authoring rules

- `src/app.module.ts` is the root module. Feature modules go in its `imports`.
  A module's `providers` stay private to that module until they are listed in
  its `exports`.
- Controllers declare routes with `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`,
  `@Head`, and `@Options`. Read request input through parameter decorators —
  `@Body`, `@Query`, `@Param`, `@Headers`, `@Cookie`, `@Store`, `@Req`, `@Set`,
  and `@Status` — rather than reaching into the raw request.
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

[`llms.txt`](llms.txt) indexes the framework documentation and published
packages.
