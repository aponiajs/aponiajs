# Request Context

A handler receives a `RouteContext`, and an enhancer receives an `ExecutionContext`.
Both are arguments passed by the framework, and both stop being available the
moment execution leaves the route. A service that a controller delegates to, a
repository a service delegates to, and downstream business logic run during an
in-flight request but cannot access the request or a correlation identifier without
threading arguments through every intermediate signature.

`RequestContextModule` establishes an opt-in per-request store backed by Node's
`AsyncLocalStorage`. It extracts or generates a correlation request ID, echoes it on
the response, and exposes the in-flight context through the injectable
`RequestContextService`.

## Enabling it

Import `RequestContextModule.forRoot(options?)` into your root module:

```ts
import { Module } from "@aponiajs/common";
import { RequestContextModule } from "@aponiajs/platform-elysia";

@Module({
  imports: [RequestContextModule.forRoot()],
})
export class AppModule {}
```

The module exports `RequestContextService`, making it injectable anywhere in the
application's module graph. Applications that do not import `RequestContextModule`
pay no overhead: no hooks run, no headers are added, and no storage is entered.

## Reading the context in services

Inject `RequestContextService` into any provider and call `current()`:

```ts
import { Injectable } from "@aponiajs/common";
import { RequestContextService } from "@aponiajs/platform-elysia";

@Injectable()
export class OrderService {
  constructor(private readonly context: RequestContextService) {}

  processOrder() {
    const current = this.context.current();

    const requestId = current?.requestId;
    const request = current?.request;

    return { requestId, url: request?.url };
  }
}
```

When called outside an active HTTP request (such as during boot or inside a background
timer), `current()` safely returns `undefined` without throwing.

## Stashing values with injection tokens

`RequestContext` supports typed per-request key-value storage using `InjectionToken<T>`.
A guard or interceptor can stash a resolved identity or tenant, and a downstream service
can read it:

```ts
import { createToken, type CanActivate, type ExecutionContext, Injectable } from "@aponiajs/common";
import { RequestContextService } from "@aponiajs/platform-elysia";

export const CURRENT_USER = createToken<{ id: string; role: string }>("auth.user");

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly context: RequestContextService) {}

  canActivate(execution: ExecutionContext): boolean {
    const current = this.context.current();
    current?.set(CURRENT_USER, { id: "user-42", role: "admin" });
    return true;
  }
}
```

A service reading the stored value:

```ts
@Injectable()
export class ProfileService {
  constructor(private readonly context: RequestContextService) {}

  getProfile() {
    const user = this.context.current()?.get(CURRENT_USER);
    return user;
  }
}
```

## Options

`RequestContextModule.forRoot()` accepts an optional `RequestContextModuleOptions` object:

```ts
RequestContextModule.forRoot({
  header: "x-correlation-id",
  generate: () => crypto.randomUUID(),
  echo: true,
});
```

| Option     | Type           | Default             | Description                                                                                                        |
| ---------- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `header`   | `string`       | `"x-request-id"`    | The HTTP request header to read the incoming ID from. Normalized to lowercase.                                     |
| `generate` | `() => string` | `crypto.randomUUID` | A generator function called when the header is missing, empty, or invalid.                                         |
| `echo`     | `boolean`      | `true`              | When `true`, sets the resolved request ID on the response header. When `false`, response headers remain untouched. |

### Header sanitization and security

Incoming request IDs are validated before use:

- Must consist only of printable ASCII characters between `0x21` (`!`) and `0x7E` (`~`).
- Must not contain whitespace, newlines (`\n`), carriage returns (`\r`), or control characters.
- Must not exceed 255 characters in length.

Any incoming header failing these requirements is discarded and replaced with a newly
generated ID.

## Deliberate scope and boundaries

- **Singleton providers:** `RequestContextService` is a singleton service over an
  `AsyncLocalStorage` store. AponiaJS retains singleton dependency injection; this
  module does not introduce request-scoped providers or request-scoped containers.
- **Error handling:** When a route handler throws, the default Problem Details error
  mapping executes within the request lifecycle, ensuring the correlation header
  is preserved on error responses (including `500 Internal Server Error`).
- **Isolation:** Each asynchronous request executes in its own storage context.
  Concurrent requests never see each other's state.
