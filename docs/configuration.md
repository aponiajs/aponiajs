# Configuration

An application declares the shape of its configuration once, has it validated
against a Standard Schema while the application boots, injects the validated
value, and reads it back from the entrypoint. The declaration lowers to an
ordinary singleton provider, so it inherits every visibility and resolution rule
the module graph already enforces and adds no new provider kind.

## Declaring it

`defineConfiguration(schema, description?)` returns a `ConfigurationToken` — an
injection token that carries the schema its value must satisfy:

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

export const AppConfig = defineConfiguration(
  z
    .object({ PORT: z.coerce.number().int().positive().default(3000) })
    .transform(({ PORT }) => ({ port: PORT })),
  "app.config",
);
```

The schema's keys are the environment's variable names: the schema above reads
`PORT`, and one declaring `port` would read a lowercase variable nothing defines
and silently apply the default whatever `PORT` said. The transform is what gives
the application the name it reads.

The schema is not a token by itself. `Token<T>` is a class or an injection
token, and a validation schema is neither, so it has no identity the graph's
lookup could key on. Wrapping it in a token is what makes it addressable, and it
is why one value is both the thing a service injects and the declaration of what
that thing is.

`defineConfiguration` reads nothing and validates nothing. A declaration made at
module evaluation is a value, so a mistake in a schema fails the boot with a
stable code instead of throwing in an import order nobody controls.
`description` names the configuration in a failure and defaults to
`"configuration"`.

## Providing it

`provideConfiguration(configuration, options?)` turns the declaration into the
provider that validates it:

```ts
import { Inject, Injectable, Module } from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/platform-elysia";
import { AppConfig } from "./config.ts";

@Injectable()
class ServerConfigReader {
  constructor(@Inject(AppConfig) readonly config: { port: number }) {}
}

@Module({
  providers: [provideConfiguration(AppConfig), ServerConfigReader],
  exports: [AppConfig],
})
export class AppModule {}
```

The two halves of this surface live in two packages, and the split is the point.
The declaration is data, so it belongs in `@aponiajs/common`. Reading the
environment is a runtime action, and `common` holds no Bun API, so the loader
lives in `@aponiajs/platform-elysia`. `provideConfiguration` is the only
boundary that reaches it; the loader itself is not exported.

The loader copies the source record before the schema sees it, so the schema
validates a stable input.

### Choosing the source

The schema validates the process environment by default. `source` replaces it,
which is what a test uses to validate a literal without touching `process.env`:

```ts
@Module({ providers: [provideConfiguration(AppConfig, { source: { PORT: "5000" } })] })
class AppModule {}
```

## Validation at boot

The provider is instantiated in the boot's first pass, so the value is validated
once, synchronously, before the application listens — and whether or not a
service injects it. Two codes can fail that instantiation, and each asks for a
different repair.

| Code                          | `details`                   | Raised when                                                                                                             |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `INVALID_CONFIGURATION`       | `{ configuration, reason }` | The declaration or the schema's answer cannot be used; `reason` is `not-a-standard-schema` or `asynchronous-validation` |
| `INVALID_CONFIGURATION_VALUE` | `{ configuration, issues }` | The schema refused the source record                                                                                    |

`INVALID_CONFIGURATION` is a defect in the declaration rather than in the value.
`reason: "not-a-standard-schema"` covers both halves of that read, because
neither a declaration nor an answer is usable when it is not shaped the way the
protocol says. The loader shape-guards `~standard`, so a declared value that is
`undefined`, a primitive, `null`, or an object with no `validate` is refused here
rather than through an engine `TypeError`; so is a validator's answer that is
`null`, a primitive, or neither a value nor `issues`, which is not a result
either. `reason: "asynchronous-validation"` means the schema's `validate`
returned a promise — a factory is invoked inside a synchronous resolve, so an
awaited validator cannot be injected. The refusal observes the promise rather
than abandoning it, so it never becomes an unhandled rejection. Both reasons are
repaired in the declaration, and no value existed to inject.

`INVALID_CONFIGURATION_VALUE` is the failure a deployment meets: the schema ran
and refused what it read. `details.issues` is the schema's own issue list, so an
issue's `path` names the key that failed, and the repair is the source record or
the schema's default rather than the declaration.

```ts
import { AponiaError } from "@aponiajs/common";

try {
  await AponiaFactory.create(AppModule, { logger: false });
} catch (error) {
  if (error instanceof AponiaError && error.code === "INVALID_CONFIGURATION_VALUE") {
    console.error(error.details);
  }
}
```

## Visibility

A configuration is an ordinary provider, so every rule the
[dependency injection guide](./dependency-injection.md) states applies
unchanged. It is private to the module that declares it until that module
exports it, and it is instantiated once per module that declares it, which is the
singleton-per-module scope every provider has.

Two consequences follow directly. A module that imports the declaring module's
export shares the one value, and a module that declares its own
`provideConfiguration(AppConfig)` validates the source again and holds a second
value. Two modules that each declare the same token therefore hold two
instances, exactly as they would for a service.

## Reading it back

The entrypoint reads a resolved value through `AponiaElysiaApplication.get`,
which resolves from the root module:

```ts
const application = await AponiaFactory.create(AppModule, { logger: false });
await application.listen(application.get(AppConfig).port);
```

The token is reachable exactly when the graph makes it reachable from the root
module, which is the rule the dependency injection guide states: `locate` checks
the root's own providers first, so a token the root module declares is reachable
whether or not it exports it, and then the imports that export the token —
ambiguous only when two of them resolve it to different modules, which raises
`AMBIGUOUS_PROVIDER` rather than picking a winner, since two that re-export one
shared provider agree. Anything else raises `MISSING_PROVIDER` — a token only a
module the root never imports declares, for instance. So does a read on an
application no boot produced, because a hand-constructed wrapper holds no
container, and the message says which of the two it was.

A failure here has not necessarily surfaced earlier. The compiler runs the same
lookup, but from the module that declares or injects the token rather than from
the root, so a configuration that resolves where it is injected can still be
unreachable from the root, or ambiguous at it, and only fail at this read. Because
the read goes through the container's cache, two reads of one token answer the
same object.

## The value

The value is the schema's own output, handed to the application exactly as the
schema returned it. It is not copied and not frozen: the resolved configuration
belongs to the application, so the application may hold a reference it shares or
extends. Only the source record is copied, and only so the schema validates a
stable input.

The failure side makes the same choice in the other direction. An
`INVALID_CONFIGURATION_VALUE` carries the schema's issues, never a copy of the
source record, so an unrelated key never travels with it. That is not redaction:
a value the schema itself names in an issue is published as the schema stated
it.

## Deliberate limits

- **No `ConfigService`.** There is no injectable service with a `get("KEY")`.
  The declaration is the token, and injecting that token is the read.
- **No partial read.** A schema validates the whole source record at once. There
  is no per-key read, no lazy read, and no way to declare one.
- **No asynchronous schema.** A factory is invoked synchronously, so a `validate`
  that returns a promise is refused rather than injected as a promise a service
  then has to await. No factory option could await one.
- **No secret redaction.** The framework does not inspect an issue for a secret;
  redaction belongs to the surfaces that hold the values.
- **No framework use of the value.** The framework never consults a resolved
  configuration to choose its own behaviour. The value is the application's, read
  through injection or `application.get`.
- **Boot-shaping variables stay with the entrypoint.** A variable the `plugins`
  option or the logger needs before a container exists cannot come from a
  declaration. The starter's `NODE_ENV` and `DEVTOOLS_PORT` stay inline reads in
  `src/main.ts`; only the value the application reads after the boot moves into
  `src/config.ts`.

## Documentation

- [Dependency injection](./dependency-injection.md): the token and visibility
  rules a configuration inherits.
- [Errors](./learn/10-errors.md): the closed code union the two failures join.
- [CLI reference](./cli.md): the starter's `src/config.ts` and what the
  generator writes around it.
- [The configuration example](../examples/configuration/README.md): the declaration, the
  injected value, and the two failures as a running application.
- [Published packages](./packages.md): the npm catalog.
