# Dependency Injection

Aponia resolves dependencies from a module graph that is compiled and validated
before the application starts. Graph and bootstrap configuration failures are
raised before the application listens. WebSocket message failures can also be
raised later, while a connected client sends messages.

## Providers

A class listed in `providers` is registered under itself and constructed with
its declared constructor dependencies:

```ts
import { Injectable, Module } from "@aponiajs/common";

@Injectable()
export class UserService {}

@Module({ providers: [UserService] })
export class UserModule {}
```

`@Injectable()` writes no metadata of its own. It exists so TypeScript emits the
constructor parameter types that the platform reads.

The descriptor helpers cover the remaining provider shapes and are also the
hand-written alternative to decorators:

```ts
import {
  createToken,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
} from "@aponiajs/common";

const APP_NAME = createToken<string>("APP_NAME");
const GREETING = createToken<string>("GREETING");

provideValue(APP_NAME, "my-api");
provideFactory(GREETING, [APP_NAME], (name) => `Hello from ${name}`);
provideClass(UserService, [GREETING]);
provideAlias(LEGACY_GREETING, GREETING);
```

- `provideValue` registers an existing value.
- `provideFactory` calls the factory with the resolved `inject` tokens.
- `provideClass(Class, inject)` constructs the class with the resolved `inject`
  tokens, under the class's own token.
- `provideClass(token, Class, inject)` binds that construction to a _different_
  token, which is how one implementation stands behind a port without the port
  naming a class: `provideClass(USERS_REPOSITORY, SqlUsersRepository, [Database])`.
  The class is not reachable under its own token unless a second provider
  declares it.
- `provideAlias` points one token at another.

Singleton is currently the only scope: each provider is instantiated once per
module that owns it, and the instance is cached.

## Tokens

A class is its own token. Anything else — a string, a configuration object, a
function — needs an explicit token, because a type cannot be injected:

```ts
import { Controller, Get, Inject, createToken } from "@aponiajs/common";

export const APP_NAME = createToken<string>("APP_NAME");

@Controller()
export class AppController {
  constructor(@Inject(APP_NAME) private readonly appName: string) {}

  @Get()
  getName(): string {
    return this.appName;
  }
}
```

`createToken<T>(description)` returns a frozen, unique token carrying its value
type. The description is only used in diagnostics.

Constructor dependencies follow the constructor that actually runs. A subclass
that declares no constructor of its own runs the parent's, so it resolves the
parent's reflected parameter types and its `@Inject()` tokens. A subclass that
declares its own constructor reads its own metadata, and only the sources it
does not declare fall back to the parent's.

## Visibility

A provider is private to its module until the module exports it, and an importer
only sees what it imported:

```ts
import { Module } from "@aponiajs/common";

@Module({
  providers: [UserService, PasswordHasher],
  exports: [UserService],
})
export class UserModule {}

@Module({ imports: [UserModule], controllers: [AccountController] })
export class AccountModule {}
```

`AccountModule` resolves `UserService` and cannot reach `PasswordHasher`.
Resolution checks the module's own providers first, then the exports of the
modules it imports. Two imports that resolve the token to different modules is an
error rather than a silent winner; two that re-export one shared provider agree on
it, because both reach the same declaring module.

## Failures

Framework diagnostics throw `AponiaError` with a stable `code` and frozen
`details`, so assertions never depend on message text. WebSocket message failures
are delivered in the gateway's `exception` envelope with the same stable code;
they do not throw through the application HTTP error path.

| Code                                  | Raised when                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `MODULE_CYCLE`                        | Module imports form a cycle                                                 |
| `DUPLICATE_MODULE`                    | One module id belongs to two definitions                                    |
| `DUPLICATE_PROVIDER`                  | A module declares the same token twice                                      |
| `INVALID_EXPORT`                      | A module exports a token it cannot resolve                                  |
| `AMBIGUOUS_PROVIDER`                  | Two imports resolve the token to different modules                          |
| `MISSING_PROVIDER`                    | A dependency cannot be resolved                                             |
| `PROVIDER_CYCLE`                      | Providers depend on each other in a cycle                                   |
| `INVALID_PROVIDER`                    | A provider entry is not a provider descriptor this release can read         |
| `UNRESOLVED_CONSTRUCTOR_DEPENDENCIES` | A class provider's constructor dependencies cannot be read                  |
| `INVALID_MODULE`                      | A class is used as a module without `@Module()`                             |
| `INVALID_CONTROLLER`                  | A controller is missing `@Controller()`, or a route handler is not callable |
| `UNSUPPORTED_CONTROLLER`              | A controller cannot be mounted by the platform                              |
| `DUPLICATE_ROUTE`                     | Two controllers claim one method and path                                   |
| `INVALID_CONFIGURATION`               | A configuration's declaration or answer is not one this release can use     |
| `INVALID_CONFIGURATION_VALUE`         | A configuration's value is refused by its own schema                        |
| `INVALID_VALIDATION_MODEL`            | A route uses a class without `@Validation()`                                |
| `INVALID_NATIVE_APPLICATION`          | `configureNative` returned a different Elysia instance                      |
| `UNSUPPORTED_ELYSIA_VERSION`          | The installed Elysia does not expose the route API this platform calls      |
| `APPLICATION_NOT_LISTENING`           | `getUrl()` is called before `listen()`                                      |
| `INVALID_WEBSOCKET_GATEWAY`           | A gateway declaration or lifecycle method is invalid                        |
| `DUPLICATE_WEBSOCKET_GATEWAY`         | Two gateways claim the same path                                            |
| `DUPLICATE_WEBSOCKET_HANDLER`         | One gateway declares the same message event more than once                  |
| `INVALID_WEBSOCKET_MESSAGE`           | A received WebSocket message is not a valid `{ event, data }` envelope      |
| `UNKNOWN_WEBSOCKET_EVENT`             | A client sends an event the gateway does not subscribe to                   |
| `WEBSOCKET_HANDLER_ERROR`             | A message or lifecycle handler fails                                        |

The first three WebSocket codes describe gateway declarations and are raised
during bootstrap. The last three describe messages after a connection has
opened; they are sent to the client through the gateway's `exception` envelope.

```ts
import { AponiaError } from "@aponiajs/common";

try {
  await AponiaFactory.create(AppModule);
} catch (error) {
  if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
    console.error(error.details);
  }
}
```

See the [architecture guide](./architecture-and-style.md) for the module,
controller, and service conventions these rules support.
