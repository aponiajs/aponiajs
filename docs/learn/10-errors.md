# 10 · Errors

**Use when:** an application needs a safe HTTP failure, bootstrap fails, or a
test needs to assert on either contract.

## Application HTTP errors

Use the intent-named defaults in controllers. Elysia handles them through its
native error response path:

```ts
import { httpErrors } from "@aponiajs/platform-elysia";

const user = users.find(id);
if (!user) {
  throw httpErrors.notFound(`User ${id} does not exist.`, {
    code: "USER_NOT_FOUND",
  });
}
```

The response has status `404`, content type `application/problem+json`, and an
RFC 9457 Problem Details body:

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "User 42 does not exist.",
  "code": "USER_NOT_FOUND"
}
```

`httpErrors` covers every 4xx and 5xx status in the supported Elysia version.
Common factories include:

| Factory                             | Status |
| ----------------------------------- | -----: |
| `httpErrors.badRequest()`           |    400 |
| `httpErrors.unauthorized()`         |    401 |
| `httpErrors.forbidden()`            |    403 |
| `httpErrors.notFound()`             |    404 |
| `httpErrors.conflict()`             |    409 |
| `httpErrors.unprocessableContent()` |    422 |
| `httpErrors.tooManyRequests()`      |    429 |
| `httpErrors.internalServerError()`  |    500 |
| `httpErrors.badGateway()`           |    502 |
| `httpErrors.serviceUnavailable()`   |    503 |

Use `httpError` when a numeric code or standard HTTP status name is clearer:

```ts
import { httpError } from "@aponiajs/platform-elysia";

throw httpError(422, "The submitted profile is invalid.", {
  code: "PROFILE_INVALID",
  type: "https://example.com/problems/profile-invalid",
  instance: "/requests/42",
  headers: { "retry-after": "30" },
  extensions: { field: "email" },
  cause: validationFailure,
});
```

`cause` is retained on the server-side `Error` for logging but is never included
in the response. Standard Problem Details members cannot be overwritten through
`extensions`; error internals such as `name`, `message`, `stack`, and `cause`
are filtered there as well.

Route validation failures remain Elysia's native `422` responses. `HttpError`
is for failures an application deliberately throws.

## Framework errors

Framework failures throw `AponiaError` with a code from a closed union and frozen
structured `details`. Assert on the code, never on message text.

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

| Code                         | Raised when                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `MODULE_CYCLE`               | Module imports form a cycle                                  |
| `DUPLICATE_MODULE`           | Two modules share one identity                               |
| `DUPLICATE_PROVIDER`         | One module declares a token twice                            |
| `INVALID_EXPORT`             | A module exports a token it cannot resolve                   |
| `AMBIGUOUS_PROVIDER`         | Two imports export the same token                            |
| `MISSING_PROVIDER`           | A dependency resolves to nothing visible                     |
| `PROVIDER_CYCLE`             | Providers depend on each other in a cycle                    |
| `INVALID_MODULE`             | A module descriptor or decorated class is malformed          |
| `INVALID_CONTROLLER`         | A controller factory returns something that is not an Elysia |
| `UNSUPPORTED_CONTROLLER`     | A controller shape the platform cannot mount                 |
| `INVALID_VALIDATION_MODEL`   | A route uses a class without `@Validation()`                 |
| `INVALID_NATIVE_APPLICATION` | `configureNative` returned a different instance              |
| `APPLICATION_NOT_LISTENING`  | `getUrl()` was called before `listen()`                      |

Graph errors through `MISSING_PROVIDER` are raised while the module graph
compiles. Provider cycles are detected while singletons initialize, and
controller or platform diagnostics are raised while routes mount. All happen
during `AponiaFactory.create`, before the application can listen.

Next: [11 · Testing](./11-testing.md) · Deep dive: [testing](../testing.md)
