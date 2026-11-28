# 04 · Providers and injection

**Use when:** a class needs a collaborator or a non-class value must be injectable.

## Class providers

```ts
import { Injectable } from "@aponiajs/common";

@Injectable()
export class UserService {
  constructor(private readonly greetingService: GreetingService) {}
}
```

`@Injectable()` is a no-op. It exists so `emitDecoratorMetadata` records the constructor parameter types the container resolves.

## Tokens

Anything that is not a class needs a token:

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

| Helper                                   | Provides                          |
| ---------------------------------------- | --------------------------------- |
| `provideValue(token, value)`             | A ready value                     |
| `provideFactory(token, inject, factory)` | The factory result                |
| `provideClass(Class, inject)`            | An instance under the class token |
| `provideClass(token, Class, inject)`     | An instance under a named token   |
| `provideAlias(token, target)`            | Another token's instance          |

## Scopes

| Scope                             | Lifetime                       |
| --------------------------------- | ------------------------------ |
| `Scope.DEFAULT` (`"singleton"`)   | One instance per owning module |
| `Scope.REQUEST` (`"request"`)     | One instance per request       |
| `Scope.TRANSIENT` (`"transient"`) | A new instance per resolution  |

```ts
import { Injectable, Scope } from "@aponiajs/common";

@Injectable({ scope: Scope.REQUEST })
export class RequestScopedLogger {}
```

## Global modules and circular references

`@Global()` shares a module's exports without explicit imports. `forwardRef()` defers one side of a circular dependency.

`container.get()` enforces root-module visibility. Resolving inside another module is a platform-internal operation.

Next: [05 · Controllers and routes](./05-controllers-and-routes.md) · Deep dive: [dependency injection](../build/dependency-injection.md)
