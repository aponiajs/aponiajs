# Validated configuration an application opts into

Status: design.

## Why this document

This is a **scope change**, and it removes one item from the scope of record.
`README.md:564-571` lists what the release does not implement:

> Not implemented yet: async provider lifecycle, request and transient scopes,
> platform-neutral HTTP packages, full Elysia phase conformance, serialization
> policy, **configuration and secret redaction**, HTTP admission hardening, …
> Treat that list as the scope of record for the current release.

"configuration" leaves that list with this design. "secret redaction" does not,
and the section that rejects it says why. The root guide states the same scope of
record in two lists (`AGENTS.md:374-389`), and its not-implemented side never
named configuration, so the only word removal is the README's: `README.md:566`
drops "configuration" and keeps "secret redaction", and the surface is named
under "Implemented" in `README.md` and `AGENTS.md`.

The framework has every primitive this needs and no surface that uses them
together. A provider can hold a value (`provideValue`, `provider.ts:9-15`), a
factory can compute one at boot (`provideFactory`, `provider.ts:17-28`), a token
can name it (`createToken`, `token.ts:3-8`), and the framework already validates
outside input with Standard Schema in the routing path (`route-schema.ts:14-16`).
What is missing is a way for an application to say _what its configuration looks
like_, have that checked once, and inject the result.

The defect that motivates it is in the generated application. The starter reads
the environment inline, at the point of use:

```ts
// packages/cli/templates/application/src/main.ts.tmpl:34,35,40
enabled: Bun.env.NODE_ENV !== "production",
port: Number(Bun.env.DEVTOOLS_PORT ?? 8000),
const port = Number(Bun.env.PORT ?? 3000);
```

`Number(Bun.env.PORT ?? 3000)` is the read this design replaces, and its default
stays: `PORT` unset still resolves to `3000`, declared in the schema rather than
inline. What changes is that `PORT=abc` fails the boot with a stable code instead
of surfacing as `NaN` when `listen` is reached; that `PORT`'s shape is stated
once, as a positive integer; and that a service and the entrypoint read one
validated value instead of two independent reads of the same variable.

## What the framework has today

Every fact below was read from the tree, not recalled.

| #   | Fact                                                                                                             | Where                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Configuration is on the not-implemented list; the paragraph is called the scope of record                        | `README.md:566`, `README.md:570`                                                                                                                                                                                                     |
| 2   | The root guide's not-implemented list does not name configuration, and calls its lists the scope of record       | `AGENTS.md:386-389`, `AGENTS.md:389-390`                                                                                                                                                                                             |
| 3   | The framework is documented as reading no environment variable for itself                                        | `docs/packages.md:91-93`, `docs/devtools.md:51-53`                                                                                                                                                                                   |
| 4   | The generated application reads `Bun.env` inline, per above                                                      | `packages/cli/templates/application/src/main.ts.tmpl:34-40`                                                                                                                                                                          |
| 5   | The starter ships a `.env.example` naming `PORT`, `DEVTOOLS_PORT`, `NODE_ENV`                                    | `packages/cli/templates/application/.env.example:1-8`                                                                                                                                                                                |
| 6   | Bun loads those files itself, so no dotenv layer is required                                                     | `node_modules/.bun/node_modules/bun-types/docs/runtime/environment-variables.mdx:6,10-15,153`                                                                                                                                        |
| 7   | The routing path already accepts any Standard Schema implementation, and recognizes one by `"~standard" in it`   | `route-schema.types.ts:1,18`, `route-schema.ts:14-16`                                                                                                                                                                                |
| 8   | `@aponiajs/common` already lists `@standard-schema/spec`; its emitted JavaScript is a 0-byte file                | `packages/common/package.json` deps; spec `dist/index.js`                                                                                                                                                                            |
| 9   | A token is a class or a `createToken` object; `tokenName` renders its description                                | `token.types.ts:9-15`, `token.ts:3-16`                                                                                                                                                                                               |
| 10  | Providers are values/factories/classes/aliases, and a factory declares its injected dependencies explicitly      | `provider.types.ts:10-60`, `provider.ts:17-28`                                                                                                                                                                                       |
| 11  | A factory is invoked **synchronously** — `Reflect.apply(provider.useFactory, …)`                                 | `container.ts:111-122`, `container.ts:117-118`                                                                                                                                                                                       |
| 12  | Providers are instantiated eagerly, once, in bootstrap's first pass over the graph, before any controller mounts | `application-bootstrap.ts:117-118`; `AGENTS.md:170-171`                                                                                                                                                                              |
| 13  | The managed application facade exposes no way to read a provider back out of the container                       | `aponia-elysia-application.ts:14-52`                                                                                                                                                                                                 |
| 14  | The build copies a non-class provider expression into a descriptor verbatim, importing the names it reads        | `descriptor-emitter.ts:863-869,885-893`                                                                                                                                                                                              |
| 15  | Standard Schema is the ecosystem contract, and this repository's own examples validate with `zod@^4.4.3`         | `examples/validation/package.json:17`; `@standard-schema/spec` `index.d.ts`                                                                                                                                                          |
| 16  | Six guard specifications enumerate packages by hand or demand a per-package artifact                             | `scripts/agent-guides.spec.ts:4-15`; `scripts/source-layout.spec.ts:11-62`; `scripts/package-llms.spec.ts:38-107`; `scripts/toolchain-config.spec.ts:24-41`; `scripts/coverage-gate.ts:98-119`; `scripts/workspace-versions.ts:3-22` |

Two of those need a note, because the brief behind this document states them
more broadly than the code does and being right about the code matters more than
agreeing.

**"The framework never reads an environment variable" is stated about devtools,
not about the framework as a whole.** The strongest sentence is
`docs/devtools.md:51-53` — "the framework never reads an environment variable on
the application's behalf, because an environment variable is not a security
boundary" — and it sits in a paragraph about the devtools `enabled` option, as
does `docs/packages.md:92-93` ("never by an environment variable the framework
reads"). The design below keeps the _decision_ where those sentences put it: the
application decides, and the framework reads nothing to decide anything for
itself. What it adds is a read the application explicitly asks for, through a
schema the application wrote. That is a shift in what the sentence has to cover,
and "What this does not change" states the edit that keeps it true rather than
leaving a false sentence standing.

**`@aponiajs/common` lists a second dependency, and it is still type-only.**
`packages/common/package.json` declares `@standard-schema/spec`, which at first
glance contradicts "`reflect-metadata` only" (`AGENTS.md:27`). The package's
emitted runtime file is 0 bytes — `node_modules/.bun/@standard-schema+spec@1.1.0/node_modules/@standard-schema/spec/dist/index.js`
— and every import of it in the package is `import type`
(`route-schema.types.ts:1`). The invariant is about runtime code and it holds;
this design adds no dependency to either package, because it reuses the
specification already present.

## What changes

The surface is two functions, one token type, two error codes, and one accessor.

| #   | Today                                                 | Change                                                                                                |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | No way to declare a configuration shape               | `defineConfiguration(schema, description?)` in `@aponiajs/common` returns a token carrying the schema |
| 2   | No way to turn the environment into an injected value | `provideConfiguration(token, options?)` in `@aponiajs/platform-elysia` returns a factory provider     |
| 3   | The union has no configuration failure                | `INVALID_CONFIGURATION` and `INVALID_CONFIGURATION_VALUE` join `AponiaErrorCode`                      |
| 4   | The managed facade cannot read a provider back out    | `AponiaElysiaApplication.get(token)` delegates to the root container's `get`                          |
| 5   | The starter reads `PORT` inline                       | The starter declares one schema, injects it, and reads the port through `application.get`             |

### 1 · The token is the schema

`defineConfiguration` in `packages/common/src/configuration/`:

```ts
// configuration.types.ts
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { InjectionToken } from "../tokens/token.types.ts";

/** A frozen injection token that carries the schema its value must satisfy. */
export interface ConfigurationToken<T> extends InjectionToken<T> {
  readonly schema: StandardSchemaV1<unknown, T>;
}

export interface ConfigurationOptions {
  /**
   * The record the schema validates. Defaults to the process environment.
   * Present so a test can validate a literal without touching `process.env`.
   */
  readonly source?: Readonly<Record<string, unknown>>;
}
```

```ts
// configuration.ts
export function defineConfiguration<const TSchema extends StandardSchemaV1>(
  schema: TSchema,
  description = "configuration",
): ConfigurationToken<StandardSchemaV1.InferOutput<TSchema>> {
  return Object.freeze({
    ...createToken<StandardSchemaV1.InferOutput<TSchema>>(description),
    schema,
  });
}
```

The token **is** the declaration: one value is both the thing a service injects
and the schema its value satisfies. This is why the schema cannot be a token by
itself — `Token<T>` is a class or an `InjectionToken` (`token.types.ts:15`), and a
validation schema is neither, so it has no identity the graph's lookup can key
on. A wrapper is not decoration; it is what makes the schema addressable.

`description` is what `tokenName` renders (`token.ts:10-16`), so it is what a
`MISSING_PROVIDER` line, an error `details`, and `/graph` name. It defaults so
the smallest declaration is one call.

### 2 · The loader lives in the platform, the contract in `common`

`provideConfiguration` in `packages/platform-elysia/src/configuration/`:

```ts
export function provideConfiguration<T>(
  configuration: ConfigurationToken<T>,
  options?: ConfigurationOptions,
): FactoryProvider<T, readonly []> {
  return provideFactory(configuration, [], () => loadConfiguration(configuration, options));
}
```

`loadConfiguration(configuration, options)` is the only code that reads the
environment. It is not exported from the package; `provideConfiguration` is the
public boundary.

The split follows the dependency direction the guide enforces (`AGENTS.md:132-137`).
A schema is data and belongs in `common`; reading `process.env` is a runtime
action and does not — `common` holds no Bun runtime API, and a boot-time read is
the platform's job. A module declares the result exactly as it declares any
provider:

```ts
// app.module.ts
import { defineConfiguration } from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/platform-elysia";
import { z } from "zod";

export const AppConfig = defineConfiguration(
  z.object({
    port: z.coerce.number().int().positive().default(3000),
    databaseUrl: z.url(),
  }),
  "app.config",
);

@Module({
  providers: [provideConfiguration(AppConfig)],
  exports: [AppConfig],
})
export class AppModule {}
```

### 3 · Validation is once, at boot, and synchronous

`provideConfiguration` is an ordinary singleton factory provider, so it is
instantiated in bootstrap's first pass over the graph
(`application-bootstrap.ts:117-118`) — once, before any controller mounts. The
loader:

1. copies `options?.source ?? process.env` into a fresh record, so the schema
   sees a stable input and later environment changes are invisible to it;
2. refuses a declaration it cannot use with `INVALID_CONFIGURATION`;
3. calls `schema["~standard"].validate(source)`;
4. refuses a `Promise` result with `INVALID_CONFIGURATION`;
5. refuses `issues` with `INVALID_CONFIGURATION_VALUE`, carrying the issues;
6. returns the validator's own output unchanged.

The synchronous requirement is not a preference: a factory is invoked with
`Reflect.apply` inside a synchronous `#resolve` (`container.ts:61-92,117-118`), so
nothing in this path can await. Supporting an asynchronous validator would mean
validating somewhere the container can await, and that is the factory option
rejected below.

### 4 · Two codes, because the reader's next action differs

`AponiaErrorCode` (`aponia-error.types.ts:1-24`) gains exactly two members:

- **`INVALID_CONFIGURATION`** — the declaration cannot be used. The value passed
  to `defineConfiguration` is not a Standard Schema (reachable only from
  JavaScript, since the type forbids it in TypeScript), or its `validate`
  answered with a `Promise`. `details: { configuration: string, reason: "not-a-standard-schema" | "asynchronous-validation" }`.
- **`INVALID_CONFIGURATION_VALUE`** — the schema refused the resolved value.
  `details: { configuration: string, issues: readonly StandardSchemaV1.Issue[] }`,
  the validator's own issues, each a
  `{ message: string, path?: ReadonlyArray<PropertyKey | PathSegment> }` where a
  `PathSegment` is `{ key: PropertyKey }` (`index.d.ts:57-68`).
  The source record is never copied into `details`.

Two and not one, for the reason `RULES.md:79` gives: tests assert on
`AponiaError.code`, so a single code would make a code defect and a bad
deployment indistinguishable at exactly the assertion this repository
standardizes on. They are also two of the framework's existing families — a
declaration error (`INVALID_PROVIDER`, `INVALID_MODULE`, `INVALID_VALIDATION_MODEL`)
beside a resolution outcome (`MISSING_PROVIDER`, `AMBIGUOUS_PROVIDER`) — and
folding them together would be the first member of that union to mean both.

The message names the token and the issue count; `issues` is the validator's own
array. That is a deliberate leak boundary, stated
so it is not mistaken for redaction: a validator is free to quote the offending
value in its message, and this design does not rewrite it. See "Options
considered and rejected".

These two codes are the boot half of the batch's convention for input a surface
cannot use: a value the framework cannot use to build the application fails the
boot with an `AponiaError` code
(`2026-09-27-aponia-utility-batch-delivery-design.md` §7).

### 5 · The entrypoint can read the resolved value back

The listen port is not a service's to inject; it is the entrypoint's, and today
the facade exposes no way to read a provider back out of the container
(`aponia-elysia-application.ts:14-52`). So `AponiaElysiaApplication` gains:

```ts
get<T>(token: Token<T>): T;
```

It delegates to the container's `get`, which already enforces root-module
visibility (`AGENTS.md:155-156`), so an unreachable token is the same
`MISSING_PROVIDER` any other root read raises. It is here because without it the
migrated `PORT` read of §8 has nowhere to go: by the time `AponiaFactory.create`
resolves the configuration has already been validated, so
`app.listen(app.get(AppConfig).port)` reads a checked value and never a raw
variable.

The bootstrap result is `@internal` (`application-bootstrap.types.ts:6-13`) and
currently carries only the application and the logger; it gains the container,
and `AponiaFactory.create` passes it to the wrapper (`aponia-factory.ts:30-31`).
That makes the constructor a public contract change rather than an internal one:
the class is exported (`index.ts:1`) and is constructed directly with the native
application and the logger today, and it gains the container as a further
argument.
`createNative` returns the raw Elysia instance (`aponia-factory.ts:51-57`), so it
has no `get` and this design does not give it one.

### 6 · Visibility is the graph's, unchanged

A configuration token is a provider token and nothing more. A service that
injects `@Inject(AppConfig)` from a module that neither owns nor imports it fails
with `MISSING_PROVIDER`; two modules exporting it to the same importer raise
`AMBIGUOUS_PROVIDER`; two providers for one token inside one module raise
`DUPLICATE_PROVIDER` (`AGENTS.md:141-152`, `packages/core/AGENTS.md:40-44`). This
is the property a bootstrap option would forfeit, and it is
why the loader is an ordinary provider.

One consequence is stated rather than hidden: declaring the provider in two
modules produces **two** validated values, one per module, because the container
caches one instance per provider per module (its only scope). The loader does not
dedupe across modules. Declare it once and export it.

`@Inject` is required and `design:paramtypes` cannot supply it: the token is an
object, not a class an emitted type could name. `INVALID_CONFIGURATION_VALUE`
fails `AponiaFactory.create` itself, so `await bootstrap()` rejects and the
process exits non-zero before any controller mounts.

### 7 · The build and inspection need no new rule

A `provideConfiguration(AppConfig)` entry is a call expression, and the emitter
already copies a non-class provider expression verbatim, importing the names it
reads (`descriptor-emitter.ts:863-869,885-893`). `provideConfiguration` is a
named value import from the platform and `AppConfig` is a named value export of
the application's own file, which is the shape that rule accepts. No helper is
added to the emitter's fixed helper set (`descriptor-emitter.ts:59-81`), and the
generated descriptor boots the same value the decorated path would.

Inspection is unaffected for a stronger reason: it constructs no provider
(`packages/platform-elysia/AGENTS.md`), so it lists the factory provider with its
empty dependency list and never runs the loader or serializes a value.

### 8 · The starter moves onto it

`templates/application/src/` gains a `config.ts` declaring one schema, and
`app.module.ts` declares `provideConfiguration(AppConfig)` and exports it.
`zod` joins the starter's dependencies at the version the examples already use
(`examples/validation/package.json:17`). `main.ts` keeps the two reads that
_shape_ the boot and moves the one that does not:

- `NODE_ENV` (for devtools `enabled`) and `DEVTOOLS_PORT` are read inline and
  passed into `AponiaFactory.create`, because they are inputs to `plugins` and
  therefore must exist before the container does;
- `PORT` is removed from `main.ts` and read after the boot as
  `application.get(AppConfig).port`, so the one value a service and the
  entrypoint can share is validated once.

That boundary — boot-shaping reads stay with the entrypoint — is a statement
about ordering, not a gap. `.env.example` keeps its three variables.

## The contract this settles

```ts
// @aponiajs/common — configuration/
function defineConfiguration<const TSchema extends StandardSchemaV1>(
  schema: TSchema,
  description?: string,
): ConfigurationToken<StandardSchemaV1.InferOutput<TSchema>>;

interface ConfigurationToken<T> extends InjectionToken<T> {
  readonly schema: StandardSchemaV1<unknown, T>;
}

interface ConfigurationOptions {
  readonly source?: Readonly<Record<string, unknown>>;
}

// @aponiajs/platform-elysia — configuration/
function provideConfiguration<T>(
  configuration: ConfigurationToken<T>,
  options?: ConfigurationOptions,
): FactoryProvider<T, readonly []>;

// @aponiajs/platform-elysia — application/
class AponiaElysiaApplication {
  get<T>(token: Token<T>): T;
}
```

- **The schema is the inference.** `StandardSchemaV1.InferOutput<TSchema>`
  (`@standard-schema/spec` `index.d.ts`) types the injected value, so a service
  annotated `@Inject(AppConfig) config: z.infer<typeof AppConfigSchema>` or the
  token's own type gets the validated shape with no cast and no `get("KEY")`
  string.
- **No validation dependency is added.** The schema is whatever Standard Schema
  implementation the application chose; any of Zod, ArkType, or Valibot works
  because the resolver tests `"~standard"` (`route-schema.ts:14-16`).
- **No coercion of this design's own.** Environment values arrive as strings and
  the schema coerces them (`z.coerce.number()`); a bespoke coercion layer would
  be a second validator beside the one the application wrote.
- **The value is the application's.** The loader returns the validator's output
  unchanged — not copied, not frozen. The framework's freeze convention covers
  descriptors it owns, and it does not own this value.
- **The source is injectable.** `options.source` exists so tests validate a
  literal; no test mutates `process.env`.

## Options considered and rejected

**A new `@aponiajs/config` package.** Rejected on cost, counted rather than
estimated. Packaging it would require, at minimum: the version bump's own list
in `package.json:34`; the pack and publish steps of `.github/workflows/publish.yml:114-120,140`
and `.github/workflows/canary.yml:67-72`; and six guard specifications — an entry
in `scripts/agent-guides.spec.ts:4-15`, an entry in `scripts/source-layout.spec.ts:11-62`,
a shipped `llms.txt` listed in `files` for `scripts/package-llms.spec.ts:38-107`,
the decorator options in its `tsconfig.json` for `scripts/toolchain-config.spec.ts:24-41`,
covered sources at the 95% floor for `scripts/coverage-gate.ts:98-119`, and a line
in `scripts/workspace-versions.ts:3-22` which `workspace-versions.spec.ts` and
`sync-version-references.spec.ts` both read. Two of the six
(`scripts/documentation-versions.spec.ts:13-21`,
`scripts/retired-literals.spec.ts:38-45`) glob the packages directory and would
pick the new one up without an edit, which is why they are not in the six. This
design instead adds one directory to each of two packages, which edits exactly
one of those guards (`source-layout.spec.ts`) and needs no manifest, workflow, or
version change.

**A `ConfigService.get("KEY")` in Nest's shape.** Rejected because it throws away
the inference this repository works to preserve everywhere else. The brief asks
for "the resolved value", and an injected typed object states the contract once,
while a string-keyed getter moves the type to every call site and lets a
mis-typed key compile. The one thing Nest's getter buys — reading a value the
declaration did not name — is not needed, because a schema names every key.

**A `configuration` option on `AponiaFactory.create`.** Rejected. It would supply
the configuration to the container without a module declaring it, so it hides the
`MISSING_PROVIDER`/`AMBIGUOUS_PROVIDER` rules that the ordinary path keeps (see
§6), and it is the only shape that could await validation, which would tie a
small feature to a graph change it does not need.

**Supporting asynchronous validation.** Rejected as a consequence of the above.
A factory is synchronous (`container.ts:118`), so a `Promise` from `validate` is
refused with `INVALID_CONFIGURATION` rather than silently awaited. Listed again
under "What remains, deliberately".

**Making `defineConfiguration` throw at import time.** Rejected: the failure
should be a boot failure with a stable code, not a module-evaluation `TypeError`
in an unpredictable import order. The declaration is checked when the provider is
instantiated, which is the same moment the value is.

**A process-global registry keyed by schema, so the schema could be its own
token.** Rejected for the reason the plugin-context design rejected ambient
registration: a global table is shared state that leaks across a compilation, and
two independent configurations written from one schema would collide on one key.

**Freezing the resolved value.** Rejected. It is the application's data, not a
framework descriptor, and freezing it would be the framework reaching into an
object it does not own.

**Secret redaction.** Rejected, and it is the design's most important omission.
`README.md:566` pairs it with configuration in one phrase; this design delivers
the first and not the second because they are different-sized concerns. Redaction
is a property of the _sinks_ a value reaches — the boot log, the devtools
`/requests` record, an inspection projection — not of the loader that produced
it, and every one of those sinks is its own surface with its own rules
(`packages/platform-elysia/AGENTS.md` on the error path and the logger;
`docs/devtools.md` on what `/requests` records). The loader's only obligation is
the narrow one it states in §4: it does not copy the source record into an error.
Smuggling a redaction policy in through a configuration loader is exactly how the
small surface becomes the large one.

**A load factory, file sources, or a remote secret manager.** Deferred. A factory
before the container, an async source, and precedence across several sources are
each a design of their own; §"What remains, deliberately" names them.

## What this does not change

- **The framework still reads no environment variable for its own behavior.**
  `docs/devtools.md:48-53` and `packages/devtools/AGENTS.md:30-32` stay true in
  their decision: the starter still decides `enabled` from `NODE_ENV`, and nothing
  in the framework consults the environment to choose its own behavior. `docs/packages.md:91-93`
  states it once more. The wording has to be narrowed to say so — it currently
  reads as though no read can ever happen — and that edit ships in the same pull
  request, the way `AGENTS.md:532-534` requires a public behavior change to.
- The dependency direction `common` ← `core` ← `platform-elysia`, and
  `common`'s type-only Standard Schema dependency, which is already there.
- `ModuleGraph` and the container: no new resolution tier, no new provider kind,
  no change to `locate`, `get`, or `resolveModuleProvider`, and no change to the
  eager first pass.
- Route validation, enhancers, WebSockets, inspection, logging, and the AOT
  artifact rules. The descriptor emitter's copy rule is used, not extended.
- The escape hatches: an application can still read `Bun.env` inline, still use
  `provideValue` with a value it computed itself, and still inject nothing. A
  module with no config provider boots exactly as it does today.
- Secret redaction remains unimplemented and is not approximated.
- `AponiaFactory.createNative` returns the native application and gains no accessor.

## Delivery order

Each step is independently reviewable and testable, and no step depends on a
later one.

1. **The token, in `common`.** `defineConfiguration`, `ConfigurationToken`,
   `ConfigurationOptions`, the frozen-value tests, and `packages/common/llms.txt`
   regenerated. Touches no boot path, so nothing can regress by booting.
2. **The loader and the codes, in the platform.** `provideConfiguration`,
   `loadConfiguration`, the two `AponiaErrorCode` members, and the failure tests.
   This is the step that can fail a boot, so it lands on the token alone.
3. **The accessor.** `AponiaElysiaApplication.get`, the `@internal` bootstrap
   result carrying the container, and the root-visibility tests.
4. **The starter.** `config.ts`, `app.module.ts`, `descriptors.generated.ts.tmpl`
   regenerated with the config provider and its export — the committed artifact
   the packed lane boots from before any build — the `main.ts` port move, the
   `zod` dependency, and the packed lane (`bun run test:generated-app`).
5. **Documentation and scope.** The new `docs/configuration.md`; the `README.md`
   and `AGENTS.md` scope edits; the `@aponiajs/common` and `@aponiajs/platform-elysia`
   READMEs, `packages/platform-elysia/llms.txt`, and `docs/packages.md`; and the
   narrowed sentences in `docs/devtools.md` and `packages/devtools/AGENTS.md`.
6. **The guard edit.** `scripts/source-layout.spec.ts` gains the two owner
   directories, shipped with step 1 or 2, because it is the one guard a directory
   addition fails.

## What remains, deliberately

- **An asynchronous schema is refused.** A validator whose `validate` returns a
  `Promise` fails the boot with `INVALID_CONFIGURATION`. Provider instantiation is
  synchronous, and closing this means validating where the container can await —
  the factory option this design rejects.
- **Secret redaction is not implemented**, and the loader makes no redaction
  promise: a validator's own message may quote a value. A redaction policy is a
  property of the log and devtools surfaces and is designed there.
- **No `ConfigService`, no per-key getter, no partial read.** The injected value
  is the whole validated object.
- **No load factory, no file source, no remote secret manager, no multi-source
  precedence.** One source (the environment, or a literal a test hands in).
- **No framework use of the configuration.** Nothing in the framework reads a
  configured value; the surface is for the application.
- **Boot-shaping variables stay with the entrypoint.** `NODE_ENV` and
  `DEVTOOLS_PORT` are read before `AponiaFactory.create` in the starter, because
  `plugins` needs them first. Moving them into the container would require
  reading boot options from a container that does not yet exist.
- **No `.env` parsing of this design's own.** Bun loads the files
  (`environment-variables.mdx:6,10-15`); this surface reads the resulting record.

## Testing

Bun is the primary lane, in both `@aponiajs/common` and
`@aponiajs/platform-elysia`; the Vite+ conformance lane mirrors the public token
type, the provider's assignability, and `AponiaElysiaApplication.get`. Every
environment case hands `loadConfiguration` a literal through `options.source`.

Behavior that must have direct evidence:

- a valid source yields a value a service injects through `@Inject(AppConfig)`,
  and the value is the validator's output;
- a missing required key fails `AponiaFactory.create` with
  `INVALID_CONFIGURATION_VALUE`, and `details.issues` names the key's path;
- a malformed key (`PORT=abc` against `z.coerce.number().int()`) fails the same
  way, which is the case the inline read cannot express;
- a schema default is applied, so an absent optional key is not a failure;
- a declaration whose schema is not a Standard Schema fails with
  `INVALID_CONFIGURATION` and `reason: "not-a-standard-schema"`;
- a schema whose `validate` returns a `Promise` fails with
  `INVALID_CONFIGURATION` and `reason: "asynchronous-validation"`;
- `details` carries no copy of the source record — asserted by shape, not by
  string matching;
- the loader validates once: the factory body runs a single `validate` call per
  boot for a provider injected by several services;
- an application with no configuration provider boots with the process
  environment unchanged and reads nothing for itself;
- a provider injected from a module that neither owns nor imports the token
  fails with `MISSING_PROVIDER`; one reached from two exports fails with
  `AMBIGUOUS_PROVIDER`; two providers inside one module fail with
  `DUPLICATE_PROVIDER`;
- `provideConfiguration` is usable through both authoring paths — a decorated
  module and `defineModule({ providers: [...] })`;
- a module declaring `provideConfiguration(AppConfig)` is lowered by the build
  into `descriptors.generated.ts`, and the boot from that artifact injects a
  value equal to the decorated boot's, which is the acceptance case
  `packages/cli/AGENTS.md` states for the emitters;
- `application.get(AppConfig)` returns the same object the container resolved,
  and `application.get` of an unreachable token raises `MISSING_PROVIDER`;
- the capped case: `bun run test:generated-app` boots the starter with `PORT` set
  and with `PORT` absent; the set case listens on the value it named, and the
  absent case listens on the schema's default rather than `NaN`.

Every case carries a mutation that makes it fail alone. The Vite+ lane mirrors the
two exported types and the accessor.

## What this document does not decide

- The default `description` string a token renders when the application names
  none, beyond that a default exists.
- Whether `application.get` should grow into a broader inspection surface (listing
  resolvable tokens, say); this document gives it exactly the read the starter
  needs.
- Whether a future reload or non-singleton scope changes "once at boot"; today the
  container has one scope (`packages/core/AGENTS.md:45-46`), and this design
  inherits it.
- Which Standard Schema library the documentation shows first. The surface is
  library-agnostic; the starter uses `zod` because the examples already do.
- The design of secret redaction, which this document places on the surfaces that
  hold the values rather than on the loader.
