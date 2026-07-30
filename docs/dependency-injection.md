# Dependency Injection

Aponia resolves dependencies from a module graph that is compiled and validated
before the application starts. Every failure below is raised at compile time,
not on the first request.

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
- `provideClass` constructs the class with the resolved `inject` tokens.
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
modules it imports. Two imports exporting the same token is an error rather than
a silent winner.

## Failures

Every failure throws `AponiaError` with a stable `code` and frozen `details`, so
assertions never depend on message text:

| Code                         | Raised when                                                                 |
| ---------------------------- | --------------------------------------------------------------------------- |
| `MODULE_CYCLE`               | Module imports form a cycle                                                 |
| `DUPLICATE_MODULE`           | One module id belongs to two definitions                                    |
| `DUPLICATE_PROVIDER`         | A module declares the same token twice                                      |
| `INVALID_EXPORT`             | A module exports a token it cannot resolve                                  |
| `AMBIGUOUS_PROVIDER`         | Two imports export the same token                                           |
| `MISSING_PROVIDER`           | A dependency cannot be resolved                                             |
| `PROVIDER_CYCLE`             | Providers depend on each other in a cycle                                   |
| `INVALID_MODULE`             | A class is used as a module without `@Module()`                             |
| `INVALID_CONTROLLER`         | A controller is missing `@Controller()`, or a route handler is not callable |
| `UNSUPPORTED_CONTROLLER`     | A controller cannot be mounted by the platform                              |
| `INVALID_VALIDATION_MODEL`   | A route uses a class without `@Validation()`                                |
| `INVALID_NATIVE_APPLICATION` | `configureNative` returned a different Elysia instance                      |
| `APPLICATION_NOT_LISTENING`  | `getUrl()` is called before `listen()`                                      |

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
