# 04 · Providers and injection

**Use when:** a class needs a collaborator, or a value that is not a class needs
to be injectable.

## Class providers

```ts
import { Injectable } from "@aponiajs/common";

@Injectable()
export class UserService {
  constructor(private readonly greetingService: GreetingService) {}
}
```

`@Injectable()` is deliberately a no-op. It exists so `emitDecoratorMetadata`
records the constructor's parameter types, which is how the container knows what
to resolve.

## Anything that is not a class needs a token

```ts
import {
  Inject,
  Injectable,
  Module,
  createToken,
  provideFactory,
  provideValue,
} from "@aponiajs/common";

export const APP_NAME = createToken<string>("APP_NAME");
export const GREETING = createToken<string>("GREETING");

@Module({
  providers: [
    provideValue(APP_NAME, "my-api"),
    provideFactory(GREETING, [APP_NAME], (name) => `Hello from ${name}`),
  ],
  exports: [GREETING],
})
export class ConfigModule {}

@Injectable()
export class GreetingService {
  constructor(@Inject(GREETING) private readonly greeting: string) {}
}
```

| Helper                                   | Provides                                  |
| ---------------------------------------- | ----------------------------------------- |
| `provideValue(token, value)`             | A ready value                             |
| `provideFactory(token, inject, factory)` | The factory's result, built once          |
| `provideClass(Class, inject)`            | An instance under the class's own token   |
| `provideClass(token, Class, inject)`     | The same instance under a token you name  |
| `provideAlias(token, target)`            | Another token's instance under a new name |

## Scopes

Aponia supports three lifetime scopes via the `Scope` object:

- **`Scope.DEFAULT` (`"singleton"`)**: Cached per owning module.
- **`Scope.REQUEST` (`"request"`)**: Instantiated once per HTTP request and cached within the request context.
- **`Scope.TRANSIENT` (`"transient"`)**: A fresh instance is instantiated on every resolution.

```ts
import { Injectable, Scope } from "@aponiajs/common";

@Injectable({ scope: Scope.REQUEST })
export class RequestScopedLogger {}
```

## Global modules and circular references

Mark a utility module with `@Global()` to make its exported providers visible across the whole module graph without needing explicit imports. For mutual dependencies, use `forwardRef()` to defer resolution.

`container.get()` enforces root-module visibility on purpose. Resolving inside
an arbitrary module is a platform-internal operation, not application API.

Next: [05 · Controllers and routes](./05-controllers-and-routes.md) ·
Deep dive: [dependency injection](../dependency-injection.md)
