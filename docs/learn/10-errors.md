# 10 · Errors

**Use when:** an application needs a safe HTTP failure, bootstrap fails, or a
test needs to assert on either contract.

## Application HTTP errors

Use the intent-named defaults in controllers:

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

## Unhandled errors

Every route carries a default Problem Details mapping last in its own error
path, behind any exception filters the route declares. An error a handler
throws that no filter answers answers `500` `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "The server could not complete this request.",
  "code": "INTERNAL_SERVER_ERROR"
}
```

The thrown value is never repeated to the client — a message is written for
whoever reads the log — and the boot's system logger records the failure under
`ExceptionsHandler`. An answer Elysia's own error path already decided is left
alone rather than translated: a validation `422`, a parse `400`, a failed
`t.Transform` decode (a `422` carrying the decode error's message), anything
throwing `status(...)`, and every `HttpError` through its own `toResponse()`.

A filter that throws or rejects does not answer with what it threw. The throw is
caught and reported through the system logger under `ExceptionsHandler`, the
filter is treated as having declined, and the route's error path continues to
whatever answers next — so a filter that throws an `HttpError` still leaves the
request to the mapping's `500` rather than answering with that `HttpError`. The
[enhancers chapter](./13-enhancers.md) covers declaring filters of your own.

Two edges of this path are worth knowing before relying on them. A status _name_
assigned to `set.status` before a throw is not resolved by Elysia on this path:
the client sees the name dropped to `200` with the message Elysia's
unknown-error fallback renders, and the mapping leaves that answer alone the way
it leaves any status Elysia already decided — write the number, or throw
`status(...)`, when the status must survive a failure. And the mapping is a
route-local `error` hook, which Elysia reads only while it composes routes ahead
of time: under `elysia: { aot: false }` no declared filter and no mapping runs,
an unhandled failure answers Elysia's native `500` carrying the exception's
message, and bootstrap warns under `RoutesResolver` about the policy.

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
| `DUPLICATE_ROUTE`            | Two controllers claim one method and path                    |
| `INVALID_VALIDATION_MODEL`   | A route uses a class without `@Validation()`                 |
| `INVALID_NATIVE_APPLICATION` | `configureNative` returned a different instance              |
| `UNSUPPORTED_ELYSIA_VERSION` | The installed Elysia moved the route API this platform calls |
| `APPLICATION_NOT_LISTENING`  | `getUrl()` was called before `listen()`                      |

Graph errors through `MISSING_PROVIDER` are raised while the module graph
compiles, and so is `DUPLICATE_ROUTE`, which decides ownership before any route
registers. Provider cycles are detected while singletons initialize, and
controller or platform diagnostics are raised while routes mount. All happen
during `AponiaFactory.create`, before the application can listen.

Next: [11 · Testing](./11-testing.md) · Deep dive: [testing](../testing.md)
