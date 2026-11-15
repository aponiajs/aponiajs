# @aponiajs/events — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The in-process event emitter, the `@OnEvent()` metadata, and the module that
provides the emitter. It is a leaf: nothing in the framework depends on it.

| Domain      | Owns                                                  |
| ----------- | ----------------------------------------------------- |
| `emitter/`  | `EventEmitter`, event names, and handler contracts    |
| `listener/` | `@OnEvent()`, listener metadata, and metadata reading |
| `module/`   | `EventEmitterModule.register`                         |

`src/index.ts` is the only public barrel.

## Invariants

- **Delivery is in-process.** This package is not a queue, an outbox, or a
  cross-process bus. Do not add retries, persistence, or at-least-once delivery
  here; those belong to a queue package.
- **Every handler runs, then failures are reported once.** A failing handler
  must not prevent later handlers from running. `emit` aggregates failures into
  one `AponiaError` with `EVENT_HANDLER_ERROR` and a frozen failure list. Do not
  expose stacks or causes.
- **Order is registration order.** `once` removes before invocation. `on` and
  `bind` return idempotent unsubscribe functions.
- **Payloads are references.** Do not clone, serialize, or validate them. A
  listener that mutates a payload mutates the object the emitter received.
- **`@OnEvent()` records metadata only.** `EventEmitter.bind(instance)` binds
  methods; the decorator must not construct or subscribe anything.
- **One emitter per registration.** Two registrations are two emitters; an
  application normally uses one.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. The Bun
lane boots a real application through `AponiaFactory.create`; both lanes assert
ordering, `once`, unsubscribe, payload preservation, and aggregate errors.
