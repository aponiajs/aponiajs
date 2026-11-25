# @aponiajs/session — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The session module, the session service, the signed-cookie policy, and the
bounded store. It is a leaf: nothing in the framework depends on it.

| Domain        | Owns                                                      |
| ------------- | --------------------------------------------------------- |
| `module/`     | `SessionModule.forRoot` and its options                   |
| `service/`    | `SessionService`, request state, and the session contract |
| `store/`      | `SessionStore` and `MemorySessionStore`                   |
| `policy/`     | HMAC-signed session cookie values                         |
| `middleware/` | The session middleware that installs the cookie writers   |
| `interfaces/` | The session, store, and memory-store contracts            |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`.

## Invariants

- **The cookie carries an id, never data.** Session data stays in the store.
- **The cookie is signed and `HttpOnly`.** Verify with a timing-safe comparison;
  never trust an unsigned or tampered value.
- **A tampered or expired cookie is cleared.** The middleware installs the
  cookie writers before the request reaches the handler, and the service writes
  the cookie the moment the session changes. Nothing waits for a hook after the
  handler, so the cookie is correct on a platform whose middleware chain does
  not wrap the handler.
- **The memory store is bounded.** `maxSessions` is a positive integer; a new
  session evicts the oldest insertion. Do not add an unbounded map.
- **`start`, `update`, and `destroy` are request-scoped.** The service reads the
  state stored by the session service; calling it outside a session-enabled
  request is a
  programming error.
- **`regenerate` deletes the old id before writing the new one.** It is the
  fixation defence: after login or a privilege change an id from before the
  change must not stay valid, and the response must carry the new cookie.
- **Configuration failures are `AponiaError` with
  `INVALID_SESSION_OPTIONS`.** Keep the code and the frozen issue list.
- **The default store is process-local.** A distributed deployment supplies a
  shared `SessionStore`; this package does not pretend to be one.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create` and drives the
cookie lifecycle through `application.handle`.
