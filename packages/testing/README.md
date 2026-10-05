# @aponiajs/testing

```bash
bun add --dev @aponiajs/testing
```

Boot an Aponia application for a test, replace one provider for one boot, and
tear it down without leaking a listener.

## What this package is, and what it is not

**This package adds no test runner and no mocking framework.** It boots an
application and hands it back; every assertion, every `test`/`it`, and every
`expect` stays the runner's. It works beside `bun:test`, `vite-plus/test`, and
`node:test` alike, because it depends on none of them. Read the next three
paragraphs before writing a case against it.

**This is not a mocking framework.** `overrideProvider` replaces one provider's
descriptor in the compiled module graph. It does not record calls, does not stub
one method of a real object, and has no equivalent of a module-interception macro
(`jest.mock`, `mock.module`): a dependency a module imported directly is beyond
its reach. A case that needs a call log writes its own object and passes it with
`useValue`, which is usually the shorter thing to write anyway. The one guarantee
it does make is the opposite direction: a token no module in the graph provides
is **refused at build time** with `MISSING_PROVIDER`, so a case can never quietly
keep talking to the real provider while believing it replaced it.

**This is not an in-memory HTTP server.** `application.handle(new Request(...))`
calls into the real route table, the real container, and the real handlers, with
no socket bound and nothing to close. It does not fake a request, does not
short-circuit validation, and does not return a synthetic `Response`. `listen()`
does the opposite of faking: it binds a real port, and it exists only because a
WebSocket upgrade needs one.

**This is not a snapshot, DOM, or filesystem tool.** It writes no files, reads no
test layout, and knows nothing about component testing.

A reader who wants none of this should keep using `@aponiajs/platform-elysia`
directly: `AponiaFactory.create(AppModule, { logger: false })` plus
`application.handle(...)` is the whole of the headline path, and
[Testing applications](../../docs/testing.md) shows it without this package.

## Booting an application

```ts
import { createTestApplication } from "@aponiajs/testing";
import { AppModule } from "../src/app.module.ts";

const application = await createTestApplication(AppModule).compile();

try {
  const response = await application.handle(new Request("http://localhost/users"));
  expect(response.status).toBe(200);
} finally {
  await application.close();
}
```

`createTestApplication(rootModule, options?)` accepts anything the factory
accepts as a root: a decorated module class, a `DynamicModule`, or a
`ModuleDefinition` a build emitted. `options` is the factory's own
`AponiaApplicationOptions`, so `plugins`, `health`, the global enhancers, and a
`LoggerService` a case wants to read all stay reachable. The one difference is
the default: **`logger` is `false`** unless a case asks for something else,
because startup output in a test report is noise a case rarely wants.

`configureNative` is the one factory option the builder does not take. It exists
to preserve the native application's own type for Eden Treaty, and
`TestApplication` erases that type to `AnyElysia` on purpose — accepting the
option would accept a type argument the wrapper discards. A case that needs it
builds through `AponiaFactory.create` instead.

Nothing is compiled until `compile()` is called. That ordering is load-bearing:
an override is a rewrite of the compiled graph, so it has to be declared before
the boot rather than applied to a running application.

## Creating a testing module (`Test.createTestingModule`)

For unit and integration tests focusing on services, repositories, or individual
modules without necessarily starting a web server, use `Test.createTestingModule`:

```ts
import { Test, type TestingModule } from "@aponiajs/testing";
import { UsersModule } from "../src/users/users.module.ts";
import { UsersService } from "../src/users/users.service.ts";
import { DatabaseService } from "../src/database/database.service.ts";

const moduleRef: TestingModule = await Test.createTestingModule({
  imports: [UsersModule],
})
  .overrideProvider(DatabaseService)
  .useValue({ query: () => [] })
  .compile();

const service = moduleRef.get(UsersService);
expect(await service.findAll()).toEqual([]);
```

`moduleRef` provides:

- `.get(token)`: resolves a provider or controller synchronously from the test container.
- `.resolve(token, context?)`: resolves a provider asynchronously, including scoped providers.
- `.createAponiaApplication(options?)`: boots a full `AponiaApplication` from this testing module with all overrides intact.
- `.close()`: runs lifecycle teardown hooks (`onModuleDestroy`).

## Replacing a provider

```ts
const application = await createTestApplication(AppModule)
  .overrideProvider(UsersRepository)
  .useValue({ findById: async () => undefined })
  .compile();
```

An override is keyed by the token the graph provides, and the rewrite walks the
whole compiled graph, so a provider an imported module exports is replaced
wherever in the graph it lives. The application's own module is never touched —
the rewrite happens in the builder's memory — so two boots from one module class
share nothing.

The four shapes match Nest's `overrideProvider` chain:

| Method                          | What it declares                                                      |
| ------------------------------- | --------------------------------------------------------------------- |
| `useValue(value)`               | Every read of the token resolves to this value.                       |
| `useFactory(factory, inject?)`  | Built once per boot; `inject` names the tokens the factory receives.  |
| `useClass(Substitute, inject?)` | Substitutes a class for the token, constructed with the named tokens. |
| `useExisting(otherToken)`       | Points the token at another token the graph already provides.         |

Each returns the builder, so the chain ends in `compile()`. `inject` is stated
rather than read from decorator metadata, because a substituted class is usually
a hand-written stub with no `@Inject()` and no `design:paramtypes` to read — a
class the compiler cannot see dependencies for is refused at boot rather than
constructed with `undefined` arguments.

Declaring the same token twice is one decision, and the later declaration wins.

## Errors

An override naming a token no module in the compiled graph provides fails
`compile()` with `AponiaError` and the code `MISSING_PROVIDER`, carrying
`{ token }`. This is the case that cannot be allowed to pass silently: a stub
registered for a token nothing provides would leave every test green while the
code under test used the real dependency.

Every other failure is the framework's own and carries the framework's own code,
because `compile()` is `AponiaFactory.create` once the overrides are applied —
`UNRESOLVED_CONSTRUCTOR_DEPENDENCIES`, `MISSING_PROVIDER`, `AMBIGUOUS_PROVIDER`,
`DUPLICATE_ROUTE`, and the rest of the closed union.

## Teardown

`close()` is idempotent, and `TestApplication` is an `AsyncDisposable`, so a
scope is enough:

```ts
await using application = await createTestApplication(AppModule).compile();

const response = await application.handle(new Request("http://localhost/users"));
```

`await using` disposes at the end of the enclosing block, on the way out of a
throw as well as on the way out of a return. A case that only drives `handle`
never opened anything, and closing is still what runs the application's shutdown
hooks.

## When a case needs a real socket

A WebSocket gateway cannot be exercised through `handle`: the upgrade needs a
real listener, and there is no way around that. `listen()` binds one and reports
both URLs:

```ts
const server = await application.listen();
const socket = new WebSocket(`${server.webSocketUrl}/chat`);
```

Port `0` asks the operating system for a free port, and `getUrl()` reports the
one it granted — so nothing here reserves a port and releases it first, which is
the dance that leaves a window in which another process can take the port before
the application binds it. `server.url` is the `http://` form and
`server.webSocketUrl` is the `ws://` form of the same socket.

Nothing else in this package opens a port.

## Links

- [Testing applications](../../docs/testing.md)
- [Lifecycle](../../docs/lifecycle.md)
- [Dependency injection](../../docs/dependency-injection.md)
- [Published packages](../../docs/packages.md)
