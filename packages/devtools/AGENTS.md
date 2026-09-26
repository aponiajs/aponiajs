# @aponiajs/devtools — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The opt-in devtools surface for a running application: the module an application
imports, the plugin that runs at `onStart`, and (from the tasks that build it)
the loopback HTTP API that reports what the running application actually is. The
package is a leaf — nothing in the framework depends on it, and an application
installs it deliberately.

| Domain       | Owns                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| `module/`    | `DevtoolsModule.register`, `DevtoolsOptions`, the plugin                   |
| `server/`    | `startDevtoolsServer`, the loopback socket, `routeRequest`, the dispatcher |
| `endpoints/` | One payload builder and its wire contract per endpoint, `/meta` first      |

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
  reported under `Devtools` with the reason, `startDevtoolsServer` returns
  `undefined`, and the application continues. The plugin's `onStart` reports
  nothing further when it sees that, so one refused bind is one row.
- The socket binds port `0` happily, and the report then names the address the
  socket took — never the port the registration asked for. A report that echoed
  the configuration would be indistinguishable from one that never bound.
- The payload is built once, when the socket starts. It describes a boot, and a
  boot does not change once it has started, so two polls of one server answer
  the same report.
- `/meta` falls back to this release for an application no boot produced, and
  says `null` for every artifact such a boot did not adopt. It never crashes on
  a missing record and never reports a guess as a release.
- The report describes the boot the _plugin's own_ application carries: Elysia
  hands `onStart` the root application, which is the one bootstrap attached the
  record to.
- The server is `Bun.serve` on its own port. It registers no Elysia route, which
  keeps `routing/native-route.ts` in `packages/platform-elysia` the only module
  in this workspace that calls Elysia's route registration API.
- Every endpoint is a `GET`; any other method answers `405` before the path is
  read, and a path the handler record does not own answers `404`. The lookup is
  `Object.hasOwn`, because the suffix comes from the request. Nothing this
  package serves mutates application state.
- `startDevtoolsServer` is synchronous, and so is the read that resolves the
  installed Elysia, because Elysia does not await `onStart`. A handler may still
  answer a promise: Task 10's analyzer loads itself on first request.
- The package reports what a boot decided; it never re-derives it. Read the boot
  record through `readApplicationDiagnostics` instead of re-applying a
  platform selector's rule here.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+.

Boot through `AponiaFactory.create` and assert what an application observes:
whether the boot mounted the plugin module (the enabled twin reports
`ElysiaPluginModule[devtools] dependencies initialized`, the disabled twin
asserts that line and every `Devtools` report absent) and what the plugin
reported at `onStart`.

The contract is HTTP, so the socket is asserted over HTTP and never assumed: a
case binds port `0`, reads the address the report named back out of it, and
fetches that address. No case depends on a fixed port, and none connects to a
port it guessed. The single exception is the default-port case, which asserts
that the row names `8000` and decides nothing about whether `8000` is free: a
bind that succeeds reports the address it took, one that is refused reports the
address it could not take.

A refused bind is asserted the same way — a blocker on port `0`, an application
whose devtools points at the port the blocker took — and the pair is what makes
the two reports distinguishable: the ephemeral case names an address that
answers, the refused case states it could not listen and leaves the application
answering its own routes.

The pure dispatcher is tested directly, because `405` and `404` are the two
answers a socket cannot demonstrate as cheaply, and the same cases run over a
real socket as well so the contract is pinned where a client meets it.

The Vite+ lane stays type-only — it mirrors `DevtoolsOptions` and the payload
types, and opens no socket. A conformance run is not the place to assert a
transport the Bun lane already drives end to end.
