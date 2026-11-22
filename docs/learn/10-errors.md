# 10 · Errors

**Use when:** an application throws a safe HTTP failure, bootstrap fails, or a test asserts on either contract.

## HTTP errors

Use the intent-named factories in controllers:

```ts
import { httpErrors } from "@aponiajs/platform-elysia";

const user = users.find(id);
if (!user) {
  throw httpErrors.notFound(`User ${id} does not exist.`, {
    code: "USER_NOT_FOUND",
  });
}
```

The response is `404 application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "User 42 does not exist.",
  "code": "USER_NOT_FOUND"
}
```

`httpErrors` covers every 4xx and 5xx status Elysia supports. Common factories include `badRequest()`, `unauthorized()`, `forbidden()`, `notFound()`, `conflict()`, `unprocessableContent()`, `tooManyRequests()`, `internalServerError()`, `badGateway()`, and `serviceUnavailable()`.

Use `httpError` when a numeric status or Problem Details extension is clearer:

```ts
throw httpError(422, "The submitted profile is invalid.", {
  code: "PROFILE_INVALID",
  type: "https://example.com/problems/profile-invalid",
  instance: "/requests/42",
  headers: { "retry-after": "30" },
  extensions: { field: "email" },
  cause: validationFailure,
});
```

`cause` stays on the server-side `Error` for logging and is never sent to the client. Standard Problem Details members cannot be overwritten through `extensions`.

Route validation failures remain Elysia's native `422` responses. `HttpError` is for failures the application deliberately throws.

## Unhandled errors

Every route the platform mounts carries a default Problem Details mapping last in its error path. An error no filter answers returns `500 application/problem+json` with code `INTERNAL_SERVER_ERROR`.

The thrown value is never sent to the client. The bootstrap logger records it under `ExceptionsHandler`.

Elysia's own decisions are left alone: validation `422`, parse `400`, `t.Transform` decode failures, `status(...)`, and every `HttpError` through its own `toResponse()`.

A filter that throws is reported and treated as having declined. The route continues to the next handler.

## Framework errors

Framework diagnostics throw `AponiaError` with a code from a closed union and frozen `details`. Assert on the code, never on message text.

```ts
import { AponiaError } from "@aponiajs/common";

try {
  await AponiaFactory.create(BrokenModule, { logger: false });
} catch (error) {
  if (error instanceof AponiaError && error.code === "MISSING_PROVIDER") {
    console.log(error.details);
  }
}
```

| Code                                  | Raised when                                         |
| ------------------------------------- | --------------------------------------------------- |
| `MODULE_CYCLE`                        | Module imports form a cycle                         |
| `DUPLICATE_MODULE`                    | Two modules share one identity                      |
| `DUPLICATE_PROVIDER`                  | One module declares a token twice                   |
| `INVALID_EXPORT`                      | A module exports a token it cannot resolve          |
| `AMBIGUOUS_PROVIDER`                  | Two imports resolve the token to different modules  |
| `MISSING_PROVIDER`                    | A dependency resolves to nothing visible            |
| `PROVIDER_CYCLE`                      | Providers depend on each other in a cycle           |
| `UNRESOLVED_CONSTRUCTOR_DEPENDENCIES` | Constructor parameter types cannot be read          |
| `INVALID_MODULE`                      | A class is used as a module without `@Module()`     |
| `INVALID_CONTROLLER`                  | A controller cannot be mounted                      |
| `DUPLICATE_ROUTE`                     | Two controllers claim one method and path           |
| `INVALID_CONFIGURATION_VALUE`         | A configuration value fails its schema              |
| `INVALID_VALIDATION_MODEL`            | A route uses a class without `@Validation()`        |
| `APPLICATION_NOT_LISTENING`           | `getUrl()` was called before `listen()`             |
| `INVALID_WEBSOCKET_GATEWAY`           | A gateway declaration is invalid                    |
| `UNKNOWN_WEBSOCKET_EVENT`             | A client sends an event the gateway does not handle |

Graph errors are raised while the module graph compiles. Controller and platform errors are raised while routes mount. Both happen during `AponiaFactory.create`, before `listen()`.

Next: [11 · Testing](./11-testing.md) · Deep dive: [execution enhancers](../build/enhancers.md)
