# @aponiajs/testing — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The test kit: a boot with sane defaults and a teardown a case can rely on, a
provider override that rewrites the compiled graph, the `handle`-first assertion
path, and the port a WebSocket case genuinely needs. It depends on `common` and
`platform-elysia`, with `elysia` as a peer, and it is a leaf — nothing in the
framework depends on it.

| Domain         | Owns                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `application/` | `createTestApplication`, the builder, `TestApplication`, and the option and server contracts              |
| `overrides/`   | `applyProviderOverrides`, the rewrite that substitutes one provider per overridden token in a module tree |

`src/index.ts` is the only public barrel. `applyProviderOverrides` is internal and
deliberately not exported: `overrideProvider` is the surface, and a second way to
name one rewrite is a second contract to keep. Keep `*.types.ts` colocated with
the runtime boundary it describes.

## Invariants

- **An override is a rewrite of the compiled descriptors, never a change to the
  platform.** `compileRootModule` (already exported from
  `@aponiajs/platform-elysia`) produces the tree, `applyProviderOverrides`
  substitutes the provider record for each overridden token, and the rewritten
  root travels to `AponiaFactory.create`, which compiles it as it would compile a
  descriptor an application wrote. Nothing in `packages/platform-elysia` knows
  this package exists, and nothing in it needed a seam added. A future feature
  that would need one — an override applied to a running application, an override
  of a controller, an override that changes a module's `imports` — is a platform
  design rather than a line here, and the honest answer is to leave it out.
- **A token no reachable module provides raises `MISSING_PROVIDER` from
  `compile()`.** It is the one failure that must never be soft: a stub registered
  for a token nothing provides leaves every test green while the code under test
  uses the real dependency, which is worse than a refused build. The code is
  reused from the closed `AponiaErrorCode` union rather than added to it, because
  it says exactly what happened, and the details are `{ token }` — the token
  name, never the value.
- **The rewrite memoizes one rewritten module per original object.** A diamond
  imports one module along two paths, and `compileRootModule` hands both slots the
  same `ModuleDefinition`. Producing two copies of it would leave two definitions
  sharing one identity, and `compileModuleGraph` refuses that with
  `DUPLICATE_MODULE` — a boot that fails for a reason the application never
  stated. `tests/provider-overrides.test.ts` boots a diamond, so removing the
  memo is a failing test rather than a rare crash.
- **`compile()` with nothing overridden hands the root straight to the factory.**
  A boot with no overrides has no graph to rewrite, and rewriting it anyway would
  change what the boot reports: a descriptor root reports `graph: "declared"` and
  a class root reports `"decorated"`, so compiling every root unconditionally
  would make an ordinary test boot claim a graph it did not serve. The no-override
  path is the factory's own boot, down to the diagnostics record, and both lanes
  assert that against a real `AponiaFactory.create` call.
- **`TestApplicationOptions` is the factory's own option type, never a subset.**
  Every option a boot takes — `plugins`, `health`, the global enhancers, a
  `LoggerService` a case wants to read — stays reachable from a test, because a
  case that cannot reach one cannot test it. A hand-written narrower copy is the
  defect this alias exists to prevent.
- **`configureNative` is deliberately not among them, and the README says so.**
  On the factory it exists to preserve the native application's own type so Eden
  Treaty can read it, and `TestApplication` erases that type to `AnyElysia`: a
  builder that accepted the option would accept a type argument it then discards,
  which is worse than not accepting it. A case that needs it calls
  `AponiaFactory.create`. Making the builder generic over `TNativeApplication`
  would not help either — the wrapper's `application` getter is the erased type
  by design, so the parameter would be decoration.
  `tests-vp/testing.conformance.ts` asserts `Extract<keyof TestApplicationOptions,
"configureNative">` is `never`, so the paragraph that states the limitation
  fails this lane rather than quietly becoming false if the platform ever moves
  that option onto the base contract. The claim was wrong in this package's first
  draft — in the README, in this guide, and in `docs/testing.md` — and every copy
  of it was corrected together, because a limitation stated in one place and
  denied in another is worse than either.
- **`logger` defaults to `false`, and that is the one difference from the
  factory.** The factory's own default is a `Logger` writing to the process
  streams; a test report does not want a boot's startup lines unless the case is
  about them. `tests/test-application.test.ts` captures `process.stdout` and
  `process.stderr` — the two writes the system logger can reach, since it bypasses
  `console` — and asserts that a default boot wrote no line while a plain factory
  boot did, so the measurement cannot pass by capturing nothing.
- **`close()` is idempotent and `Symbol.asyncDispose` is the same call.** A test
  that opened a listener must not be able to leak it, whether it closed in a
  `finally` or fell out of an `await using` scope on a throw. The shutdown hooks
  are the application's own — this package adds none.
- **`listen()` binds port `0` and reads the port back from `getUrl()`.** Never
  reserve an ephemeral port by opening a server and closing it before the
  application binds: the window between the two is where another process takes
  the port, and the failure is a flake nobody can reproduce. This is the whole
  reason the harness exists, so it is the one property not to regress.
- **`handle()` is the headline path and opens nothing.** A case that only asserts
  HTTP behaviour must never need `listen()`, a port, or a `close()`.
- **`useFactory` and `useClass` state their `inject` tokens explicitly.** A
  substituted class is usually a hand-written stub with no `@Inject()` and no
  `design:paramtypes`, so there is no metadata to read and reading it would refuse
  the most natural stub in the language. An omitted `inject` states a factory that
  resolves nothing, which is the cast in `test-application-builder.ts` and the
  only place this package narrows a generic to the default it already declares.
- **`overrideProvider` builds its four methods as arrow functions.** They capture
  the builder lexically, so a case that detaches `useValue` from the chain still
  registers on the builder that handed it out. A `const builder = this` alias does
  the same thing and is refused by the workspace's own lint rule, which is why the
  arrows are written out.
- **The package states its boundary and does not oversell it.** The README opens
  with "What this package is, and what it is not", naming what it does not do — no
  test runner, no mocking framework, no in-memory HTTP server, no snapshot or DOM
  tooling — and says what the wrong assumption costs. `llms.txt` carries the same
  paragraph shortened, because that is the surface an agent reads first. A feature
  that would make a claim there untrue changes the README in the same pull
  request, and a claim that cannot be kept is deleted rather than qualified.

## Tests

`tests/*.test.ts` under Bun, `tests-vp/*.conformance.ts` under Vite+. Both lanes
boot real applications; neither lane mocks the framework it is testing.

The Vite+ lane runs on **Node, not Bun**, and Elysia 2 has no adapter there: a
`listen()` in `tests-vp/**` throws `requires an adapter` from inside Elysia. So
the conformance lane never calls `listen()` and never binds a socket, and every
real-port case belongs in the Bun lane. This is a property of the lane rather
than of this package, and `@aponiajs/platform-elysia`'s guide states the same
rule for its own lanes.

The Bun lane owns:

1. an override reaching the route under test — asserted through
   `application.handle`, so a substitute that reached the container but not the
   controller injecting it cannot pass;
2. an override of a provider an imported module exports, which is what proves the
   rewrite walks the graph rather than the root module's own provider list;
3. a diamond graph still booting, which is the memoization;
4. `MISSING_PROVIDER` with `details.token` for a token no module provides;
5. two boots from one module class not sharing state, with the plain boot still
   resolving the real provider;
6. all four override shapes, and the later declaration winning for one token;
7. a descriptor root, reporting `graph: "declared"`;
8. the default logger writing nothing, measured against a plain boot that does;
9. the no-override boot answering exactly as `AponiaFactory.create` does;
10. `close()` twice, `await using`, and the application's shutdown hooks running
    once;
11. a real port from `listen()`, released by `close()`;
12. a gateway over a real socket, with the `{ event, data }` envelope asserted
    end to end — the case the port harness exists for, driven through
    `tests/gateway.test.ts` and never through a reserved port.

The Vite+ lane mirrors the public contract: the option alias, the builder and
application shapes, the barrel's value exports, an override reaching a route, the
`MISSING_PROVIDER` refusal, and the no-override equivalence — all without a
socket.

`tests/fixtures.ts` holds the tokens, the two greeter implementations, and the
shutdown probe both lanes share. It is not a test file and Bun's glob does not
collect it.
