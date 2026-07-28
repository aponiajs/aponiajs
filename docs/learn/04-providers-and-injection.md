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
| `provideClass(Class, inject)`            | An instance constructed from the tokens   |
| `provideAlias(token, target)`            | Another token's instance under a new name |

## Scope

Singleton is the only scope. The container caches one instance per provider per
module and detects dependency cycles while resolving, raising `PROVIDER_CYCLE`.

`container.get()` enforces root-module visibility on purpose. Resolving inside
an arbitrary module is a platform-internal operation, not application API.

Next: [05 · Controllers and routes](./05-controllers-and-routes.md) ·
Deep dive: [dependency injection](../dependency-injection.md)
