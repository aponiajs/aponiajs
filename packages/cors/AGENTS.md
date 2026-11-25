# @aponiajs/cors — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

The module an application imports to answer cross-origin requests, and the
validated configuration the policy is read from. The policy is a neutral
`HttpPolicy` built from `@aponiajs/platform-core`'s CORS helpers, so the shared
request pipeline answers the same headers and preflight on every platform. It
is a leaf — nothing in the framework depends on it.

| Domain        | Owns                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| `module/`     | `CorsModule.forRoot`, `CorsModuleOptions`, the `DynamicModule` one registration lowers into   |
| `policy/`     | the neutral CORS policy, the guard that reads a configuration value into it, and the contract |
| `interfaces/` | the module and policy contracts                                                               |

`src/index.ts` is the only public barrel. Type-only contracts live in
`interfaces/<name>.interface.ts`.

## Invariants

- **The policy is the shared pipeline's, not a runtime plugin's.** The headers,
  the preflight answer, and the header values come from
  `@aponiajs/platform-core`'s CORS helpers, which the same request pipeline runs
  on every platform. A feature that would make this package more than that — an
  origin predicate of its own, a route-scoped policy, a header builder — is a
  different package, and the answer to "should this package do this?" is no even
  when the answer would be convenient. The README leads with module registration
  and keeps the raw-plugin alternative in its final Native escape hatch section;
  a package that oversells a thin policy is the defect this repository cares most
  about.
- **The configuration carries data only, and the boundary is stated rather than
  widened.** The wrapped plugin's `origin` also accepts a `RegExp` and a
  `(request) => boolean` function. Neither is a value an environment can supply,
  so `CorsConfiguration.origins` is a list of exact origin strings and the guard
  refuses anything else with `INVALID_CONFIGURATION_VALUE`. A reader who needs a
  pattern or a predicate mounts the raw plugin, which the README names and
  `src/module/cors-module.spec.ts` demonstrates by booting both sides of the boundary.
  Widening the type to match the plugin's own `CORSConfig` would make that
  paragraph false; `test/cors.conformance.ts` pins `keyof CorsConfiguration`
  so the widening fails `bun run check` instead.
- **`credentials` defaults to `false`, which is this adapter's own default and
  not the plugin's.** `@elysia/cors` defaults `credentials` to `true` and its
  `origin` to `true`, which together reflect any request `Origin` beside
  `Access-Control-Allow-Credentials: true`. A package that passed those through
  would ship the footgun by default, so `origins` is required and `credentials`
  defaults to `false`. Do not restate the wrapped plugin's defaults as though
  they were this package's; the README's table is the record.
- **A wildcard origin beside credentialed requests is refused, and it is a
  boot-time refusal rather than a served response.** A browser rejects
  `Access-Control-Allow-Origin: *` beside
  `Access-Control-Allow-Credentials: true`, so the pair is not a policy a browser
  honors. Serving it would push the failure to the client, where it reads as a
  network error rather than as a misconfiguration.
- **Every refusal of the configuration is `AponiaError` with
  `INVALID_CONFIGURATION_VALUE` and `{ configuration, issues }`.** The shape a
  schema refusal already carries, so a caller reads one contract whichever half
  refused. The issue list is total: every field that fails is reported rather
  than the first, because a value the schema did not build can be wrong in more
  than one place and a boot that names one field at a time is a boot a maintainer
  runs seven times.
- **The guard fills every field the plugin reads, including the ones it would
  default.** The options object is therefore a pure function of the validated
  value — and so is the plugin's Elysia identity, which the plugin derives from
  that object (`{ name: "@elysiajs/cors", seed: config }`). That is what makes
  two registrations answering the same policy share one mount and two answering
  different policies mount twice. A guard that passed `undefined` through for an
  omitted field would hand the plugin a different seed and change which
  registrations collapse.
- **One registration per application is the supported shape, and both halves are
  pinned.** Two registrations sharing a key are `DUPLICATE_MODULE`
  (`PluginModule[cors]`); two under distinct keys that resolve equal policies
  produce two graph nodes and one native mount (two `OPTIONS` routes, not four);
  two that resolve different policies both mount and answer as a union. A
  per-registration handle would remove the ambiguity and is deliberately not
  here, for the same reason cron and openapi give. The Bun lane pins all three,
  so a change that lifts the limitation has to change the README with it.
- **The module provides the configuration it consumes and exports it.** The
  module is registered by the application that also declares the configuration,
  so a design where the application declares the token and the module imports it
  would be a module cycle. Owning the declaration makes one module the whole
  story, and exporting it keeps `application.get(CorsConfig)` working for the
  application that wrote it. `source` exists because `provideConfiguration`
  accepts it: a test validates a literal rather than mutating the process
  environment, and no case in either lane touches `process.env`.
- **No policy value can be exported beside the module.** The CORS policy is
  built from a value the container resolves, so it exists only inside a boot. An
  application that needs the descriptor artifact untouched mounts the raw Elysia
  CORS plugin through `AponiaApplicationOptions.plugins` and gives up the module
  and its validation.

## Tests

`src/**/*.spec.ts` under Bun, `test/*.conformance.ts` under Vite+. Both lanes
boot real applications through `AponiaFactory.create` and read real response
headers through `application.handle(new Request(...))`, because what this package
promises is a set of headers and nothing less than a response proves it. No case
asserts on a message string.

The Bun lane owns:

1. an allowed origin answers with `Access-Control-Allow-Origin` and
   `Vary: Origin`, a denied one answers with neither an allow-origin nor an
   error, and `credentials` is absent unless the application asked for it;
2. the preflight answer: `204`, the allow-origin, the requested method echoed,
   and the configured `max-age`;
3. a `404` carries the policy, because the plugin answers from a `request` hook
   that runs before routing;
4. a schema refusal, a value only a runtime can produce, a value that states no
   policy, and the wildcard-with-credentials pair each fail the boot with the
   code and the total issue list;
5. the dedup behaviour, all three profiles — the same key is `DUPLICATE_MODULE`,
   distinct keys with equal policies are two graph nodes and one native mount
   (counted in the inspected graph and in the native route table), and distinct
   keys with different policies are two mounts;
6. the boundary: a `RegExp` origin is refused through this package and served by
   the raw plugin, which is the paragraph the README states;
7. `src/generated-descriptors.spec.ts` pins the `aponia build` consequence: a
   module whose `imports` name a registration is declined, the artifact holds
   nothing for it, and the application boots and answers anyway because the
   platform lowers the root from its decorators.

The Vite+ lane mirrors the contract and the observable answers. It must not call
`listen()`: the lane runs on Node, where Elysia 2 has no adapter and a listen
throws. `application.handle` answers without opening a port, and the policy is a
hook over the response either way, so everything this package promises is
observable there. Cases that need a real port belong in the Bun lane.
