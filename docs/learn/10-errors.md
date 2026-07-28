# 10 · Errors

**Use when:** a bootstrap fails, or a test needs to assert on the failure.

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
| `INVALID_NATIVE_APPLICATION` | `configureNative` returned a different instance              |
| `APPLICATION_NOT_LISTENING`  | `getUrl()` was called before `listen()`                      |

Everything above the last two is raised at compile time, before any instance
exists, which is why a broken graph never reaches a listening port.

Route validation failures are different: they are Elysia's own, and answer `422`
without throwing.

Next: [11 · Testing](./11-testing.md) · Deep dive: [testing](../testing.md)
