# Migrating from NestJS

AponiaJS keeps the authoring model Nest teaches — decorators, modules, providers,
guards, interceptors, filters, pipes — and runs it on Elysia instead of Express
or Fastify. Most application code moves by changing imports; the places it does
not are listed below.

## Packages

| NestJS                     | AponiaJS                                      |
| -------------------------- | --------------------------------------------- |
| `@nestjs/common`           | `@aponiajs/common`                            |
| `@nestjs/core`             | `@aponiajs/core`                              |
| `@nestjs/platform-express` | `@aponiajs/platform-elysia` (Elysia)          |
| `@nestjs/config`           | `provideConfiguration` from `platform-elysia` |
| `@nestjs/swagger`          | `@aponiajs/openapi`                           |
| `@nestjs/terminus`         | `health: true` on the application             |
| `@nestjs/websockets`       | gateway decorators in `@aponiajs/common`      |
| `@nestjs/bull`             | `@aponiajs/queue` (process-local)             |
| TypeORM or Prisma layer    | `@aponiajs/database` (Drizzle)                |

## Boot

```ts
// NestJS
const app = await NestFactory.create(AppModule);
await app.listen(3000);

// AponiaJS
const app = await AponiaFactory.create(AppModule);
await app.listen(3000);
```

`AponiaFactory.create` compiles the decorated classes into frozen descriptors
before anything mounts, so a duplicate token, an unresolved dependency, or a
cycle fails the boot instead of the first request. The same descriptors can be
written by hand with `defineModule` and `defineController`, which is what makes
generated code and decorator code equal at runtime.

A `forRoot()`-style registration returns `dynamicModule({ module, providers })`.
The helper derives `id` from the class name and a fresh `instanceId`, so a
Nest-shaped registration does not have to state the two Aponia-only identity
fields; passing either one still overrides the derivation.

## What maps directly

`@Module`, `@Controller`, `@Injectable`, `@Inject`, `@UseGuards`,
`@UseInterceptors`, `@UseFilters`, `@UsePipes`, `@SetMetadata`, `@Catch`,
`@Body`, `@Query`, `@Param`, `@Headers`, `@Ip`, `@All`, `@Header`,
`@HttpCode`, and the HTTP method decorators keep their names and meaning. The
lifecycle interfaces keep theirs too:
`onModuleInit`, `onApplicationBootstrap`, `beforeApplicationShutdown`,
`onModuleDestroy`, `onApplicationShutdown`.

`@Injectable()` is optional and stays a no-op; it exists so
`emitDecoratorMetadata` records constructor types. Providers are resolved by
token, and a provider that is not exported from its module is invisible to an
importer — the same visibility rule Nest enforces.

Provider object literals keep their Nest shape: `{ provide, useClass, useValue,
useFactory, useExisting, inject? }` is accepted and lowered to the canonical
provider. A decorated `useClass` without `inject` infers its constructor
dependencies; a descriptor written by hand states `inject`.

`APP_GUARD`, `APP_INTERCEPTOR`, `APP_FILTER`, and `APP_PIPE` keep their names and
their meaning: provide one under its token in a module's `providers` and it runs
on every route. `useClass` binds an instance to the token, the way Nest does;
`useValue` may carry a class the container resolves (sharing the instance routes
already name) or a configured instance. Several enhancers of one kind are a list
under that one token, because the container registers one provider per token in
a module.

## What changes

**Validation is not class-validator.** A route declares a Standard Schema
validator (Zod, Valibot, ArkType) or an Elysia/TypeBox schema, either directly or
through a `@Validation()` model class. One model is one schema: create, update,
and path contracts are separate classes rather than one DTO with groups.

**Handlers receive the Elysia context.** `@Req()` gives the platform-neutral
`RouteContext`; the handler's second argument is the native Elysia context when a
route needs plugin decorators. There is no manual reply object: return a value, throw `HttpError`, or set a
status through `@HttpStatus()`.

**Interceptors and filters use plain values.** A returned Promise is awaited.
There is no RxJS in the runtime; a generator result is not supported where Nest
would stream an Observable.

**Errors are RFC 9457 Problem Details.** `HttpError` and `httpErrors` answer
`application/problem+json` with no stack or cause. Any other thrown value becomes
a `500` through the system logger unless a filter answers it first.

`@Session()` is available from `@aponiajs/session`: it injects the session the
plugin loaded, or one field of its data. `@HostParam()` injects the request
host, and `@HostParam("tenant")` injects its first label; the framework does not
route by subdomain.

**Mapped DTO types call your validator's own combinators.**
`partialSchema`, `pickSchema`, `omitSchema`, and `intersectSchema` call the
validator's own `partial`/`pick`/`omit`/`extend`; a validator that exposes no
such operation is refused with `INVALID_VALIDATION_MODEL` rather than
approximated. The one-schema-per-class rule still holds: the derived schema is
its own `@Validation()` class.

**Configuration is validated once.** A module declares its schema; the value is
parsed at boot and fails with `INVALID_CONFIGURATION_VALUE`. No package reads
`process.env` on the application's behalf.

**The web layer is Elysia.** Native plugins mount through `PluginModule` and
`definePlugin`; a handler can read what a plugin adds when the controller's
context type names it. Express middleware and Nest's `NestMiddleware` are
replaced by `AponiaMiddleware` over the same route plan, or by a native plugin
when the behavior is genuinely request-scoped.

## CLI

| NestJS CLI                     | AponiaJS CLI                        |
| ------------------------------ | ----------------------------------- |
| `nest new`                     | `aponia new` / `bun create aponia`  |
| `nest generate resource users` | `aponia generate resource users`    |
| `nest generate module`         | `aponia generate module`            |
| `nest generate library`        | `aponia g library <name> --publish` |

`aponia g library` emits a publishable package with both test lanes and an
`aponia.library.json`; `aponia library check` validates that surface without
writing anything.

## Not available

Express- or Fastify-specific middleware is out of scope for this release;
message transports are available through `@aponiajs/microservices`, and Web
Fetch and AWS Lambda adapters through `@aponiajs/serverless`. Blade views and
templates are available through `@aponiajs/view`. WebSocket
gateways speak the documented JSON envelope over Elysia's native socket rather
than Socket.IO namespaces, rooms, or acknowledgement callbacks.

## Checklist

1. Replace the framework, platform, and config imports.
2. Move DTOs to `@Validation()` classes and declared route schemas.
3. Replace manual replies with return values, `HttpError`, or `@HttpStatus()`.
4. Point Swagger at `@aponiajs/openapi` and Terminus-style checks at a route of your own beside `health: true`.
5. Replace the ORM layer with `@aponiajs/database` or keep it behind providers.
6. Run `bun run check` and `bun run test:coverage`; a missing `design:paramtypes` shows up as an empty route plan, so check the application's own `tsconfig.json` first.
