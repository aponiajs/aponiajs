# @aponiajs/devtools — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The opt-in devtools surface for a running application: the module an application
imports, the plugin that runs at `onStart`, and (from the tasks that build it)
the loopback HTTP API that reports what the running application actually is. The
package is a leaf — nothing in the framework depends on it, and an application
installs it deliberately.

| Domain    | Owns                                                     |
| --------- | -------------------------------------------------------- |
| `module/` | `DevtoolsModule.register`, `DevtoolsOptions`, the plugin |

`src/index.ts` is the only public barrel. Keep `*.types.ts` colocated with the
runtime boundary it describes.

## Invariants

- Registration is the opt-in and `enabled` is the switch. The framework never
  reads an environment variable on the application's behalf, because an
  environment variable is not a security boundary.
- A disabled registration mounts nothing: no provider, no native plugin, and so
  no socket — the plugin is the only thing in this package that starts a server,
  so the socket absence follows by construction from the plugin absence. It is
  an inert module rather than a plugin that does nothing, so a boot cannot
  mistake it for the enabled one.
- The module is an `ElysiaPluginModule` because the plugin has to see the
  mounted route table. A plain provider is constructed before any controller
  mounts and cannot; an Elysia plugin runs at `onStart`, after every route is
  mounted. Never construct a second plugin instance or add a separate devtools
  container.
- `onStart` fires on `listen()`. An application that only calls `handle()`
  publishes nothing and must be unaffected — that is accepted behavior, not a
  defect to work around.
- The bind address is `127.0.0.1`, always, and there is no `host` option to set
  to `0.0.0.0` by accident. A debugging aid that reaches a public interface is
  the failure mode this package exists not to have.
- A debugging aid must never fail a boot: a port that is already bound is
  reported under `Devtools` and the application continues.
- The server is `Bun.serve` on its own port. It registers no Elysia route, which
  keeps `routing/native-route.ts` in `packages/platform-elysia` the only module
  in this workspace that calls Elysia's route registration API.
- Every endpoint is a `GET`; any other method answers `405` and an unknown path
  answers `404`. Nothing this package serves mutates application state.
- The package reports what a boot decided; it never re-derives it. Read the boot
  record through `readApplicationDiagnostics` instead of re-applying a
  platform selector's rule here.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+.

Boot through `AponiaFactory.create` and assert what an application observes:
whether the boot mounted the plugin module (the enabled twin reports
`ElysiaPluginModule[devtools] dependencies initialized`, the disabled twin
asserts that line and every `Devtools` report absent) and what the plugin
reported at `onStart`. The disabled case is proven by the inert module's
descriptor and the missing mount line, never by a connection: nothing in this
package serves yet, so no test can connect to it. The port assertion — against
a server on an ephemeral port — lands with the server in Task 4.
