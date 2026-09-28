# Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An application can declare the shape of its configuration once, have it validated at boot against a Standard Schema it chose, inject the validated value, and read it back from the entrypoint — replacing a per-use `Number(Bun.env.PORT ?? 3000)` with a value that fails the boot on `PORT=abc`.

**Architecture:** A token that carries its own schema lives in `@aponiajs/common` (a schema is data); the loader that reads the environment lives in `@aponiajs/platform-elysia` (a boot-time read is a runtime action, and `common` holds no Bun API). The provider is an ordinary singleton factory, so it inherits every visibility rule the graph already enforces — `MISSING_PROVIDER`, `AMBIGUOUS_PROVIDER`, `DUPLICATE_PROVIDER` — and one validated value per module, unchanged. The entrypoint reads the value back through a new `AponiaElysiaApplication.get`, which reaches the container through the same non-enumerable symbol seam the boot record and the lifecycle plan already use, so the wrapper's exported two-argument constructor stays intact.

**Tech Stack:** TypeScript (strict, ESM, `#private`), Bun test, Vite+ conformance, Elysia 1.4.30, `@standard-schema/spec@1.1.0` (type-only), `zod@^4.4.3` in the starter (as the examples already use).

**Spec:** `docs/superpowers/specs/2026-09-27-aponia-configuration-design.md`

## What the spec leaves to this plan, settled before Task 1

1. **The container reaches the wrapper through a symbol, not a third constructor argument.** The
   spec's §5 hands `AponiaElysiaApplication` the container by adding a required third parameter and
   calls that "a public contract change rather than an internal one". That is a breaking change to
   an exported class that three tracked sites construct with two arguments
   (`tests/platform.test.ts:460`, `:526`, `tests/bootstrap-edge.test.ts:124`), for a feature that does
   not need one: this package's own precedent — the boot record attached under
   `Symbol.for("aponia.application.diagnostics")` as a non-enumerable, non-writable,
   non-configurable property, read by a dedicated accessor — carries the same data with no signature
   change, and the lifecycle seam that shipped after this spec was written uses exactly that shape.
   The plan follows the precedent: the boot attaches the container under
   `Symbol.for("aponia.application.container")`, and `AponiaElysiaApplication.get` reads it through
   `readApplicationContainer`.
2. **`get` on a wrapper no boot produced raises `MISSING_PROVIDER`.** A hand-constructed
   `AponiaElysiaApplication` holds no container, and `close()`'s precedent — fall back to the old
   behaviour — has no analogue for a read that has no answer. It raises the code the graph already
   raises for a token nothing can resolve, with a message that says the application holds no
   container because no boot produced it. A new `AponiaErrorCode` member would widen a closed union
   for a case the spec did not ask it to cover.
3. **The error-code documentation tables are repaired, not merely extended.** The union's members are
   re-stated in three places, and two of them are already wrong before this change: `AGENTS.md:321-333`
   omits `UNSUPPORTED_ELYSIA_VERSION`, and both `docs/dependency-injection.md:115-137` and
   `docs/learn/10-errors.md:141-163` omit `INVALID_PROVIDER` and `UNRESOLVED_CONSTRUCTOR_DEPENDENCIES`.
   `RULES.md:12-13` settles it — "If documentation and enforcement disagree, fix both in the same
   change" — so the two new members are added and the pre-existing omissions are closed in the same
   edit, with the omissions named in the commit body.
4. **Two citations in the spec are off by one line, and the plan uses the tree.** The scope-of-record
   paragraph is `README.md:563-570` with the word on line 565, not `:564-571`/`:566`. Every file:line
   below was re-read.
5. **The descriptor emitter needs no change.** The spec's `provideConfiguration(AppConfig)` is a call
   expression in `providers` and a bare identifier in `exports`, which are the two shapes the emitter
   already copies verbatim (`descriptor-emitter.ts:863-869`, `:885-893`). Nothing is added to its
   fixed helper set.

## Global Constraints

- Every file, comment, and document is English. Before finishing a task:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- **Branch `feature/configuration`, from `release/alpha`.** Do not push, and do not bump the version
  until the branch is integrated; a push to a release branch publishes every package.
- **No runtime dependency is added.** `@standard-schema/spec` stays type-only in `common` (its
  emitted JavaScript is a 0-byte file and every import of it there is `import type`), and
  `@aponiajs/common`'s only runtime dependency stays `reflect-metadata`. The starter gains `zod` as
  an _application_ dependency, which is a template edit and not a framework one.
- **Validation is synchronous and a `Promise` is refused.** A factory is invoked by
  `Reflect.apply` inside a synchronous `#resolve` (`container.ts:117-118`), so an awaited validator
  is not available here. `validate`'s result is tested for a promise and refused with
  `INVALID_CONFIGURATION`, `reason: "asynchronous-validation"`.
- **Recognition of a schema is shape-guarded.** The repository's only existing recognition,
  `isStandardSchema` (`route-schema.ts:14-16`), is `"~standard" in validator` and throws a
  `TypeError` for `undefined` or a primitive. The loader checks that the schema is an object before
  the membership test, so a JavaScript caller passing a non-object gets `INVALID_CONFIGURATION` with
  `reason: "not-a-standard-schema"` rather than an engine error.
- **The loader returns the validator's own output unchanged** — not copied, not frozen, and never
  the source record. An error's `details` carries the issues and never a copy of the source.
- **`@aponiajs/core` gains nothing.** No new resolution tier, no provider kind, no change to
  `locate`, `get`, `resolveModuleProvider`, or the eager first pass.
- **No barrel export goes unlisted in a package's `llms.txt`**, and both new owner directories are
  registered in `scripts/source-layout.spec.ts` in the step that creates them — that guard compares
  the exact sorted directory set and fails until both are added.
- Gates before each task's commit: `bun run check` plus the lanes that task names. Whole-branch
  verification, after Task 5, runs `bun run check`, `bun run test:coverage`,
  `bun run test:vite-plus`, `bun run test:examples`, `bun run release:dry-run` (published contents
  change — two barrels gain exports), then `bun run build` followed by `bun run test:generated-app`,
  which is the only lane that packs the CLI, generates an application, and boots it. After any
  `bun run build`, delete the declarations it leaves beside sources before a test lane:
  `find packages -name '*.d.ts' -path '*/src/*' -delete`.
- Markdown tables are formatter-owned: `bun run check --fix`, then re-verify.
- Commit bodies explain why the change is right and end with
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Review Focus

Six input classes the spec's Testing section names and no task's prose would otherwise cover. Each
line's test is in the task named beside it.

1. **A schema whose `validate` returns a `Promise`.** A reasonable person expects the boot to fail
   with a stable code rather than to inject an unresolved promise that a service then awaits.
   (Task 2)
2. **A schema that is not a schema at all** — `undefined`, a string, an object without `~standard` —
   reaching the loader from JavaScript. `INVALID_CONFIGURATION` with a named reason, never a
   `TypeError` from a membership test. (Task 2)
3. **A malformed environment value**: `PORT=abc` against `z.coerce.number().int().positive()`. The
   boot fails with `INVALID_CONFIGURATION_VALUE` and the issue's path names the key, which is the
   case the inline `Number(...)` read cannot express at all. (Task 2)
4. **`application.get` of a token nothing can reach**, and of a token on an application no boot
   produced. `MISSING_PROVIDER` in both cases, with the second saying why. (Task 3)
5. **A generated application with `PORT` absent.** It must listen on the schema's default, and the
   case must not assume a fixed port is free — the packed lane reserves one. (Task 4)
6. **The committed descriptor artifact staying in step.** The starter's
   `descriptors.generated.ts.tmpl` is byte-compared against a regeneration by
   `packages/cli/tests/starter-artifact-freshness.test.ts`, and the packed lane boots from it, so a
   module edit without a regeneration fails a lane that no default `bun test` reaches. (Task 4)

---

### Task 1: The token

**Files:**

- Create: `packages/common/src/configuration/configuration.types.ts`
- Create: `packages/common/src/configuration/configuration.ts`
- Modify: `packages/common/src/index.ts` (the barrel)
- Modify: `packages/common/AGENTS.md` (the domain table gains the directory)
- Modify: `scripts/source-layout.spec.ts` (the `packages/common/src` directory list)
- Modify: `packages/common/llms.txt`
- Create: `packages/platform-elysia/tests-vp/configuration.conformance.ts` (the token's type half;
  Task 2 and Task 3 extend it)
- Test: `packages/common/tests/configuration.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `defineConfiguration(schema, description?)` returning
  `ConfigurationToken<StandardSchemaV1.InferOutput<TSchema>>`, and the types
  `ConfigurationToken<T>` and `ConfigurationOptions`, all from `@aponiajs/common`.

- [ ] **Step 1: Write the failing test**

`packages/common/tests/configuration.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { z } from "zod";
// Relative, like every other test in this directory: importing the package by
// its own name from inside it resolves to `dist/`, which CI never builds.
import { defineConfiguration } from "../src/index.ts";

describe("defineConfiguration", () => {
  test("carries the schema it was given", () => {
    const schema = z.object({ port: z.coerce.number().int().positive() });

    const token = defineConfiguration(schema, "app.config");

    expect(token.schema).toBe(schema);
  });

  test("is a token the graph can key on", () => {
    const token = defineConfiguration(z.object({ port: z.number() }), "app.config");

    expect(typeof token.id).toBe("symbol");
    expect(token.description).toBe("app.config");
  });

  test("is frozen, so a declaration cannot be edited after it is made", () => {
    const token = defineConfiguration(z.object({ port: z.number() }));

    expect(Object.isFrozen(token)).toBe(true);
  });

  test("names itself when the caller does not", () => {
    const token = defineConfiguration(z.object({ port: z.number() }));

    expect(token.description).toBe("configuration");
  });
});
```

`zod` is already a dependency of `examples/validation`, and this repository's tests import packages
that are workspace dependencies; add `zod@^4.4.3` to `packages/common`'s **devDependencies** if the
import does not resolve, and say so in the report. It is a test dependency only.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/common/tests/configuration.test.ts`
Expected: FAIL — `defineConfiguration` is not exported from `@aponiajs/common`.

- [ ] **Step 3: Write the token**

`packages/common/src/configuration/configuration.types.ts`:

```ts
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { InjectionToken } from "../tokens/token.types.ts";

/**
 * An injection token that carries the schema its value must satisfy.
 *
 * The schema cannot be a token by itself: `Token<T>` is a class or an
 * `InjectionToken`, and a validation schema is neither, so it has no identity
 * the graph's lookup could key on. This wrapper is not decoration — it is what
 * makes the schema addressable, and it is why one value is both the thing a
 * service injects and the declaration of what that thing is.
 */
export interface ConfigurationToken<T> extends InjectionToken<T> {
  readonly schema: StandardSchemaV1<unknown, T>;
}

/** How a loader is asked to validate something other than the process environment. */
export interface ConfigurationOptions {
  /**
   * The record the schema validates. Defaults to the process environment.
   * Present so a test can validate a literal without touching `process.env`.
   */
  readonly source?: Readonly<Record<string, unknown>>;
}
```

`packages/common/src/configuration/configuration.ts`:

```ts
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createToken } from "../tokens/token.ts";
import type { ConfigurationToken } from "./configuration.types.ts";

/**
 * Declares a configuration: the schema its value must satisfy, and the name a
 * failure prints.
 *
 * The declaration is checked when the provider is instantiated, not here: a
 * throw at module evaluation would fail in an import order nobody controls,
 * where a boot failure carries a stable code and a readable message.
 */
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

In `packages/common/src/index.ts`, beside the other exports of its domain:

```ts
export { defineConfiguration } from "./configuration/configuration.ts";
export type {
  ConfigurationOptions,
  ConfigurationToken,
} from "./configuration/configuration.types.ts";
```

- [ ] **Step 4: Register the directory in the guard and the guide**

In `scripts/source-layout.spec.ts`, add `"configuration"` to the `packages/common/src` directory
list, alphabetically (before `"controllers"`).

In `packages/common/AGENTS.md`, add a row to the "What this package owns" table:

```markdown
| `configuration/` | The configuration token that carries its own schema |
```

`scripts/AGENTS.md` states the invariant this closes: a new source domain updates the guide and the
guard together, and no guard reads the guide's table.

- [ ] **Step 5: Run the test and the guards**

Run: `bun test packages/common/tests/configuration.test.ts`
Expected: 4 pass.

Run: `bun test scripts/source-layout.spec.ts scripts/agent-guides.spec.ts`
Expected: pass.

- [ ] **Step 6: Advertise the export and commit**

In `packages/common/llms.txt`, the function is a runtime export and the two types are not, so each
goes in the section that names it and each links the file that declares it:

```markdown
- [defineConfiguration](https://github.com/aponiajs/aponiajs/blob/release/alpha/packages/common/src/configuration/configuration.ts): declares a configuration as a token that carries the Standard Schema its value must satisfy.
```

in the exports list, and:

```markdown
- [ConfigurationToken, ConfigurationOptions](https://github.com/aponiajs/aponiajs/blob/release/alpha/packages/common/src/configuration/configuration.types.ts): the declaration's token type and the options a loader is asked with.
```

in the public-types list. `scripts/package-llms.spec.ts` resolves both paths against the tree, so
both files must exist before the entry is added.

```bash
bun run check --fix
bun test packages/common scripts/
git add packages/common scripts/source-layout.spec.ts
git commit -m "feat(common): declare a configuration as a token carrying its schema"
```

---

### Task 2: The loader and the two codes

**Files:**

- Create: `packages/platform-elysia/src/configuration/configuration-loader.ts`
- Create: `packages/platform-elysia/src/configuration/provider.ts`
- Modify: `packages/platform-elysia/src/index.ts` (the barrel)
- Modify: `packages/common/src/errors/aponia-error.types.ts` (the union gains two members)
- Modify: `packages/platform-elysia/AGENTS.md` (the domain table gains the directory)
- Modify: `scripts/source-layout.spec.ts` (the `packages/platform-elysia/src` directory list)
- Modify: `packages/platform-elysia/llms.txt`
- Modify: `AGENTS.md`, `docs/dependency-injection.md`, `docs/learn/10-errors.md` (the code lists)
- Modify: `packages/platform-elysia/tests-vp/configuration.conformance.ts`
- Test: `packages/platform-elysia/tests/configuration.test.ts`

**Interfaces:**

- Consumes: `defineConfiguration`, `ConfigurationToken`, `ConfigurationOptions` from Task 1.
- Produces: `provideConfiguration(configuration, options?)` returning
  `FactoryProvider<T, readonly []>`, and the codes `INVALID_CONFIGURATION` and
  `INVALID_CONFIGURATION_VALUE`.

- [ ] **Step 1: Write the failing test**

`packages/platform-elysia/tests/configuration.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  AponiaError,
  Inject,
  Injectable,
  Module,
  defineConfiguration,
  defineModule,
  provideClass,
  type AponiaErrorCode,
} from "@aponiajs/common";
import { z } from "zod";
import { AponiaFactory, provideConfiguration } from "../src/index.ts";

function codeOf(error: unknown): AponiaErrorCode | undefined {
  return error instanceof AponiaError ? error.code : undefined;
}

const portSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
});

describe("provideConfiguration", () => {
  test("injects the validator's own output", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");
    const seen: number[] = [];

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {
        seen.push(config.port);
      }
    }

    @Module({ providers: [provideConfiguration(AppConfig), Reader] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    expect(seen).toEqual([3000]);
    await application.close();
  });

  test("applies a schema default when the key is absent", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");
    let resolved: { port: number } | undefined;

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {
        resolved = config;
      }
    }

    @Module({
      providers: [provideConfiguration(AppConfig, { source: {} }), Reader],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    expect(resolved).toEqual({ port: 3000 });
    await application.close();
  });

  test("refuses a malformed value with the issue's path", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");

    @Module({
      providers: [provideConfiguration(AppConfig, { source: { port: "abc" } })],
    })
    class AppModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION_VALUE");
    const details = (thrown as AponiaError).details as {
      configuration: string;
      issues: readonly { readonly path?: readonly unknown[] }[];
    };
    expect(details.configuration).toBe("app.config");
    expect(details.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(details.issues)).toContain("port");
  });

  test("refuses a declaration that is not a schema", async () => {
    const notASchema = defineConfiguration(
      { validate: "nope" } as unknown as z.ZodType,
      "app.config",
    );

    @Module({ providers: [provideConfiguration(notASchema, { source: {} })] })
    class AppModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION");
    expect((thrown as AponiaError).details).toMatchObject({
      configuration: "app.config",
      reason: "not-a-standard-schema",
    });
  });

  test("refuses a schema whose validate returns a promise", async () => {
    const asynchronous = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async () => ({ value: { port: 3000 } }),
      },
    };
    const AppConfig = defineConfiguration(asynchronous as never, "app.config");

    @Module({ providers: [provideConfiguration(AppConfig, { source: {} })] })
    class AppModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION");
    expect((thrown as AponiaError).details).toMatchObject({
      configuration: "app.config",
      reason: "asynchronous-validation",
    });
  });

  test("refuses a missing required key with the issue's path", async () => {
    const required = defineConfiguration(
      z.object({ databaseUrl: z.string().min(1) }),
      "app.config",
    );

    @Module({ providers: [provideConfiguration(required, { source: {} })] })
    class AppModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION_VALUE");
    expect(JSON.stringify((thrown as AponiaError).details)).toContain("databaseUrl");
  });

  test("is usable through the descriptor path as well", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");
    let resolved: { port: number } | undefined;

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {
        resolved = config;
      }
    }

    const module = defineModule({
      id: "descriptor-app",
      providers: [
        provideConfiguration(AppConfig, { source: { port: 5000 } }),
        provideClass(Reader, [AppConfig]),
      ],
    });

    const application = await AponiaFactory.create(module, { logger: false });

    expect(resolved).toEqual({ port: 5000 });
    await application.close();
  });

  test("refuses a token a module neither owns nor imports", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {}
    }

    @Module({ providers: [provideConfiguration(AppConfig, { source: {} })] })
    class ConfigModule {}

    // Reader is declared in a module that never imports ConfigModule, so the
    // graph cannot resolve the token it asks for.
    @Module({ providers: [Reader] })
    class AppModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("MISSING_PROVIDER");
    void ConfigModule;
  });

  test("carries no copy of the source record", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");

    @Module({
      providers: [provideConfiguration(AppConfig, { source: { port: "abc", secret: "hunter2" } })],
    })
    class AppModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION_VALUE");
    expect(JSON.stringify((thrown as AponiaError).details)).not.toContain("hunter2");
  });

  test("validates once per boot, however many services inject the value", async () => {
    let validations = 0;
    const counted = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => {
          validations += 1;
          return { value: { port: 3000 } };
        },
      },
    };
    const AppConfig = defineConfiguration(counted as never, "app.config");

    @Injectable()
    class First {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {}
    }

    @Injectable()
    class Second {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {}
    }

    @Module({
      providers: [provideConfiguration(AppConfig, { source: {} }), First, Second],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    expect(validations).toBe(1);
    await application.close();
  });

  test("keeps the graph's visibility rules", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {}
    }

    @Module({ providers: [provideConfiguration(AppConfig)], exports: [AppConfig] })
    class ConfigModule {}

    @Module({ imports: [ConfigModule], providers: [Reader] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    const other = defineConfiguration(portSchema, "unreachable");

    @Module({ providers: [provideConfiguration(other, { source: {} })] })
    class OtherModule {}

    const separate = await AponiaFactory.create(OtherModule, { logger: false });

    expect(application).toBeDefined();
    expect(separate).toBeDefined();
    await application.close();
    await separate.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/configuration.test.ts`
Expected: FAIL — `provideConfiguration` is not exported from the platform barrel.

- [ ] **Step 3: Write the loader**

`packages/platform-elysia/src/configuration/configuration-loader.ts`:

```ts
import { AponiaError, type ConfigurationOptions, type ConfigurationToken } from "@aponiajs/common";

/**
 * The only code in the framework that reads the environment, and only for a
 * declaration an application asked for.
 *
 * It is not exported from the package: `provideConfiguration` is the boundary,
 * and a loader an application could call directly would be a second way to
 * build a value the graph never sees.
 */
export function loadConfiguration<T>(
  configuration: ConfigurationToken<T>,
  options?: ConfigurationOptions,
): T {
  const name = configuration.description ?? "configuration";
  const schema = configuration.schema as unknown;

  // Shape first, membership second: `"~standard" in value` throws for
  // `undefined` and for a primitive, and a JavaScript caller has no type checker
  // to stop them. A refusal has to be this framework's code, not the engine's.
  if (typeof schema !== "object" || schema === null || !("~standard" in schema)) {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was declared with a value that is not a Standard Schema.`,
      { configuration: name, reason: "not-a-standard-schema" },
    );
  }

  const validator = (schema as { readonly "~standard": { validate?: unknown } })["~standard"];
  if (typeof validator.validate !== "function") {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was declared with a value that is not a Standard Schema.`,
      { configuration: name, reason: "not-a-standard-schema" },
    );
  }

  // A copy, so the schema sees a stable input and a later change to the
  // environment cannot reach a value that was already validated.
  const source = { ...(options?.source ?? Bun.env) };
  const result = (validator.validate as (value: unknown) => unknown)(source);

  // A factory is invoked by `Reflect.apply` inside a synchronous resolve, so
  // nothing here can await. Refusing a promise is what keeps an injected value
  // from being a promise a service then has to await for itself.
  if (typeof (result as { then?: unknown } | null)?.then === "function") {
    throw new AponiaError(
      "INVALID_CONFIGURATION",
      `Configuration "${name}" was validated by a schema that answers asynchronously, which a provider cannot await.`,
      { configuration: name, reason: "asynchronous-validation" },
    );
  }

  const outcome = result as
    { readonly value: T; readonly issues?: undefined } | { readonly issues: readonly unknown[] };

  if ("issues" in outcome && outcome.issues !== undefined) {
    throw new AponiaError(
      "INVALID_CONFIGURATION_VALUE",
      `Configuration "${name}" was refused by its schema with ${outcome.issues.length} issue(s).`,
      { configuration: name, issues: Object.freeze([...outcome.issues]) },
    );
  }

  return (outcome as { readonly value: T }).value;
}
```

`packages/platform-elysia/src/configuration/provider.ts`:

```ts
import {
  type ConfigurationOptions,
  type ConfigurationToken,
  provideFactory,
} from "@aponiajs/common";
import type { FactoryProvider } from "@aponiajs/common";
import { loadConfiguration } from "./configuration-loader.ts";

/**
 * Turns a declaration into an ordinary singleton provider.
 *
 * Nothing here is special to configuration: because it is a factory provider it
 * is instantiated once per module in the boot's first pass, it is visible only
 * where the graph says it is, and a module that declares it twice in one module
 * fails like any other duplicate.
 */
export function provideConfiguration<T>(
  configuration: ConfigurationToken<T>,
  options?: ConfigurationOptions,
): FactoryProvider<T, readonly []> {
  return provideFactory(configuration, [], () => loadConfiguration(configuration, options));
}
```

- [ ] **Step 4: Add the two codes and export the provider**

In `packages/common/src/errors/aponia-error.types.ts`, add to the union after
`"UNRESOLVED_CONSTRUCTOR_DEPENDENCIES"`:

```ts
  | "INVALID_CONFIGURATION"
  | "INVALID_CONFIGURATION_VALUE"
```

In `packages/platform-elysia/src/index.ts`, in the export block for its own domain:

```ts
export { provideConfiguration } from "./configuration/provider.ts";
```

- [ ] **Step 5: Register the directory and correct every code list**

In `scripts/source-layout.spec.ts`, add `"configuration"` to the `packages/platform-elysia/src`
directory list, alphabetically. In `packages/platform-elysia/AGENTS.md`, add the domain row:

```markdown
| `configuration/` | The boot-time loader that validates a declared configuration |
```

Then add the two members to **all three** lists, and close the omissions this plan's third
settlement names while you are in them: `AGENTS.md:321-333` gains the two new codes _and_
`UNSUPPORTED_ELYSIA_VERSION`; `docs/dependency-injection.md:115-137` and
`docs/learn/10-errors.md:141-163` gain the two new codes _and_ `INVALID_PROVIDER` and
`UNRESOLVED_CONSTRUCTOR_DEPENDENCIES`. Each table's wording for a new row matches the rows beside
it, and the failure each row describes is the failure the union's member is raised for.

- [ ] **Step 6: Run the tests and the guards**

Run: `bun test packages/platform-elysia/tests/configuration.test.ts`
Expected: 11 pass.

Run: `bun run --filter @aponiajs/platform-elysia test`
Expected: pass.

Run: `bun test packages/common scripts/`
Expected: pass.

- [ ] **Step 7: Mirror the public surface in the conformance lane and commit**

**Add to the file Task 1 created; do not rewrite it.** That file already declares the token's type
half, including `AppConfig`, the `VitePlusTest` type, and the `test`/`expect` declarations. Add only
what is missing — the imports the new code needs, the provider's assignability pin, the module, and
the runtime case — and reuse `AppConfig` as it stands rather than declaring a second one. Pasting a
whole file here would produce `Cannot redeclare block-scoped variable 'AppConfig'` and duplicate
`declare` identifiers, so the additions are:

```ts
import { type Provider } from "@aponiajs/common";
import { Inject, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory, provideConfiguration } from "../src/index.ts";

// The settled contract: a declaration lowers to an ordinary provider.
const asProvider = provideConfiguration(AppConfig) satisfies Provider;

@Injectable()
class Reader {
  constructor(@Inject(AppConfig) readonly config: { port: number }) {}
}

@Module({ providers: [provideConfiguration(AppConfig), Reader] })
class ConfigModule {}

test("resolves a declared configuration through a real boot", async () => {
  const application = await AponiaFactory.create(ConfigModule, { logger: false });
  try {
    expect(application).toBeDefined();
  } finally {
    await application.close();
  }
});

void asProvider;
```

Merge each import into the line already there rather than adding a second import of the same module,
and keep the file's existing compile-time assertions above the additions.

In `packages/platform-elysia/llms.txt`, add to the exports list:

```markdown
- [provideConfiguration](https://github.com/aponiajs/aponiajs/blob/release/alpha/packages/platform-elysia/src/configuration/provider.ts): turns a declared configuration into the singleton provider that validates it once at boot.
```

```bash
bun run check --fix
bun test packages/platform-elysia/tests/configuration.test.ts
bunx vp test packages/platform-elysia/tests-vp/configuration.conformance.ts
bun test scripts/package-llms.spec.ts
git add packages/common/src/errors packages/platform-elysia packages/common/llms.txt AGENTS.md docs
git commit -m "feat(platform-elysia): validate a declared configuration once at boot"
```

---

### Task 3: The accessor

**Files:**

- Create: `packages/platform-elysia/src/application/application-container.ts`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts` (attach the container)
- Modify: `packages/platform-elysia/src/application/aponia-elysia-application.ts` (`get`)
- Modify: `packages/platform-elysia/tests/configuration.test.ts`
- Modify: `packages/platform-elysia/tests-vp/configuration.conformance.ts`
- Test: `packages/platform-elysia/tests/configuration.test.ts`

**Interfaces:**

- Consumes: the container the boot already holds, and the codes from Task 2.
- Produces: `AponiaElysiaApplication.get<T>(token: Token<T>): T`.

- [ ] **Step 1: Write the failing test**

Append to `packages/platform-elysia/tests/configuration.test.ts`:

```ts
describe("AponiaElysiaApplication.get", () => {
  test("reads back the same object the container resolved", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {}
    }

    @Module({
      providers: [provideConfiguration(AppConfig, { source: { port: 4321 } }), Reader],
      exports: [AppConfig],
    })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    expect(application.get(AppConfig)).toEqual({ port: 4321 });
    await application.close();
  });

  test("raises MISSING_PROVIDER for a token the application cannot reach", async () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");
    const unreachable = defineConfiguration(portSchema, "unreachable");

    @Module({ providers: [provideConfiguration(AppConfig, { source: {} })] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    let thrown: unknown;
    try {
      application.get(unreachable);
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("MISSING_PROVIDER");
    await application.close();
  });

  test("raises MISSING_PROVIDER on an application no boot produced", () => {
    const AppConfig = defineConfiguration(portSchema, "app.config");
    const detached = new AponiaElysiaApplication(new Elysia(), undefined);

    let thrown: unknown;
    try {
      detached.get(AppConfig);
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("MISSING_PROVIDER");
    expect((thrown as AponiaError).message).toContain("no boot produced");
  });
});
```

with `Elysia` imported from `elysia` and `AponiaElysiaApplication` from `../src/index.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/configuration.test.ts -t "get"`
Expected: FAIL — `application.get is not a function`.

- [ ] **Step 3: Attach the container through the symbol seam**

`packages/platform-elysia/src/application/application-container.ts`:

```ts
import { AponiaError, type Token } from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";

const containerKey: unique symbol = Symbol.for("aponia.application.container");

/**
 * Attaches the boot's container to the application it produced.
 *
 * The property is non-enumerable, non-writable, and non-configurable for the
 * same reason the boot record's is: Elysia composes by walking an instance's
 * keys, and an application no boot produced must read as `undefined` rather than
 * as an empty container. Rides a symbol rather than a constructor parameter so
 * the wrapper's exported two-argument signature does not change.
 */
export function attachApplicationContainer(application: object, container: AponiaContainer): void {
  Object.defineProperty(application, containerKey, {
    value: container,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/** The container a boot attached, or `undefined` for an application no boot produced. */
export function readApplicationContainer(application: unknown): AponiaContainer | undefined {
  return (application as { [containerKey]?: AponiaContainer } | null | undefined)?.[containerKey];
}

/**
 * The value a token resolves to, through the container a boot attached.
 *
 * An application no boot produced holds no container and has no graph to find
 * the token in, which is the same fact `MISSING_PROVIDER` states — the code the
 * graph raises for a token nothing can resolve. The message says which of the
 * two it was.
 */
export function readApplicationToken<T>(application: unknown, token: Token<T>): T {
  const container = readApplicationContainer(application);
  if (!container) {
    throw new AponiaError(
      "MISSING_PROVIDER",
      `Provider "${String(token)}" cannot be read: no boot produced this application, so it holds no container.`,
      { token: String(token) },
    );
  }

  return container.get(token);
}
```

In `application-bootstrap.ts`, beside `attachApplicationDiagnostics(...)`:

```ts
attachApplicationContainer(nativeApplication, container);
```

In `aponia-elysia-application.ts`, add the method and its import:

```ts
  /**
   * The value a token resolves to, read from the container the boot built.
   *
   * Root visibility applies, exactly as it does for any other read from the root:
   * a token this application cannot reach raises `MISSING_PROVIDER`.
   */
  get<T>(token: Token<T>): T {
    return readApplicationToken(this.#nativeApplication, token);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/platform-elysia/tests/configuration.test.ts`
Expected: 14 pass.

- [ ] **Step 5: Mirror the accessor in the conformance lane and commit**

In `packages/platform-elysia/tests-vp/configuration.conformance.ts`, add a case that calls
`application.get(AppConfig)` on a booted application and asserts the value's shape, then:

```bash
bun run check --fix
bun test packages/platform-elysia/tests/configuration.test.ts
bun run --filter @aponiajs/platform-elysia test
bunx vp test packages/platform-elysia/tests-vp/configuration.conformance.ts
git add packages/platform-elysia
git commit -m "feat(platform-elysia): read a resolved value back from the entrypoint"
```

---

### Task 4: The starter

**Files:**

- Create: `packages/cli/templates/application/src/config.ts.tmpl`
- Modify: `packages/cli/templates/application/src/app.module.ts.tmpl`
- Modify: `packages/cli/templates/application/src/main.ts.tmpl`
- Modify: `packages/cli/templates/application/package.json` (the `zod` dependency)
- Modify: `packages/cli/templates/application/src/descriptors.generated.ts.tmpl` (regenerated)
- Modify: `packages/cli/tests/project-generator.test.ts` (the rendered-substring assertions)
- Test: `packages/cli/tests/starter-artifact-freshness.test.ts`, `packages/cli/e2e/generated-application.e2e.ts`

**Interfaces:**

- Consumes: `defineConfiguration`, `provideConfiguration`, and `get` from Tasks 1 to 3.
- Produces: a generated application whose port comes from a validated configuration.

- [ ] **Step 1: Write the starter's configuration and wire it**

`packages/cli/templates/application/src/config.ts.tmpl`:

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

/**
 * The application's configuration, declared once.
 *
 * `PORT` arrives as a string and the schema coerces it, so `PORT=abc` fails the
 * boot with a stable code instead of reaching `listen` as `NaN`. The default
 * lives here rather than at the read.
 */
export const AppConfig = defineConfiguration(
  z.object({
    port: z.coerce.number().int().positive().default(3000),
  }),
  "app.config",
);
```

In `app.module.ts.tmpl`, add the provider and export it, keeping the file's existing comments:

```ts
import { Module } from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/platform-elysia";
import { AppController } from "./app.controller.ts";
import { AppService } from "./app.service.ts";
import { AppConfig } from "./config.ts";

@Module({
  providers: [provideConfiguration(AppConfig), AppService],
  controllers: [AppController],
  exports: [AppConfig],
})
export class AppModule {}
```

In `main.ts.tmpl`, replace the inline port read with a read of the validated value, and leave the
two reads that shape the boot where they are:

```ts
const application = await AponiaFactory.create(AppModule, { logger: false, enabled, devtools });
await application.listen(application.get(AppConfig).port);
```

Read the template as it stands before editing it: the two boot-shaping reads (`NODE_ENV` for the
devtools `enabled` and `DEVTOOLS_PORT`) stay inline and stay in their current order, because the
`plugins` option needs them before the container exists. Only the `PORT` read moves.

- [ ] **Step 2: Add the dependency and regenerate the committed artifact**

In `packages/cli/templates/application/package.json`, add `"zod": "^4.4.3"` to `dependencies`
(the version `examples/validation` already uses).

Then regenerate the committed descriptor artifact, which the packed lane boots from _before_ any
build. The artifact is what `aponia build` writes into a generated application, so produce it the
way the packed lane does rather than by hand:

1. In a temporary directory outside the repository, generate an application from the edited
   templates (`bun run --cwd packages/cli ...`'s entrypoint, or `bun create aponia` pointed at the
   packed CLI) and run its `build` script — the same command the packed lane runs, which writes
   `src/invokers.generated.ts` and `src/descriptors.generated.ts`.
2. Copy the generated `src/descriptors.generated.ts` over
   `packages/cli/templates/application/src/descriptors.generated.ts.tmpl`, leaving the `elysia`
   provenance line as the committed file has it — the freshness test normalizes that line and
   compares everything else byte for byte.
3. Run `bun test packages/cli/tests/starter-artifact-freshness.test.ts`. It is the check: it
   regenerates from the templates and compares against the committed file, so it fails until the
   copy above is exactly what the emitter produces.

The artifact's `providers` list gains `provideConfiguration(AppConfig)` and its module gains the
`exports` entry; if the copy leaves either out, the test says so.

- [ ] **Step 3: Run the CLI's own tests and the packed lane**

```bash
bun test packages/cli/tests/
bun run test:generated-app
```

Expected: both pass. The packed lane packs all six workspaces, installs the packed CLI, generates
an application, installs _its_ dependencies (including the new `zod`), runs its `check`, `test`, and
`test:e2e`, then boots `src/main.ts` and `dist/main.js` and asserts the HTTP answer and the
`Booting AppModule from the generated module descriptors` startup line. **Nothing else catches a
descriptor artifact left stale**, so this lane is the acceptance test for this task.

- [ ] **Step 4: Add the PORT-absent case to the packed lane**

The lane currently sets `PORT` before booting. Add one boot with `PORT` absent, asserting the
application answers on the schema's default. Do not assert a fixed port is used: reserve an
ephemeral one and pass it as the configured value in the set case, so the two cases are the same
shape. The absent case asserts only that the server answers, because the default is `3000` and the
lane cannot assume that port is free.

- [ ] **Step 5: Update the generator's assertions and commit**

`packages/cli/tests/project-generator.test.ts` asserts rendered substrings. Add what the new shape
requires — `app.module.ts` contains `provideConfiguration(AppConfig)` and `exports: [AppConfig]`,
`config.ts` exists and contains `defineConfiguration` — and keep the existing assertion that no
rendered file contains `{{`.

```bash
bun run check --fix
bun test packages/cli/tests/
bun run test:generated-app
git add packages/cli
git commit -m "feat(cli): generate an application whose port is a validated configuration"
```

---

### Task 5: The documentation and the scope

**Files:**

- Create: `docs/configuration.md`
- Modify: `docs/AGENTS.md` (the published-document table)
- Modify: `README.md` (the navigation list, the implemented paragraph, the not-implemented list)
- Modify: `AGENTS.md` (the implemented paragraph)
- Modify: `docs/packages.md`, `docs/devtools.md`, `packages/devtools/AGENTS.md` (the narrowed sentences)
- Modify: `packages/common/README.md`, `packages/platform-elysia/README.md`

**Interfaces:**

- Consumes: the surface Tasks 1 to 4 built.
- Produces: the pages and the scope-of-record edits the release claims.

- [ ] **Step 1: Write the reference page**

`docs/configuration.md`, in this repository's reference voice, covering: the declaration and why the
token carries its schema; the loader's split (contract in `common`, the environment read in the
platform); validation once at boot, synchronously, with the two failure codes and what a reader does
differently for each; the visibility rules a configuration inherits because it is an ordinary
provider, including the two-instances-in-two-modules consequence; `application.get` and its
root-visibility; that the resolved value is the application's and is not frozen or copied; and the
deliberate limits — no `ConfigService`, no partial read, no asynchronous schema, no secret redaction,
no framework use of the value, and boot-shaping variables staying with the entrypoint. Copy the
snippets from the tests Task 2 wrote rather than writing new ones.

- [ ] **Step 2: Move the scope-of-record lists**

`README.md:563-570` currently opens `Not implemented yet: async provider lifecycle, request and
transient scopes, platform-neutral HTTP packages, full Elysia phase conformance, serialization
policy, configuration and secret redaction, …`. Line 565 drops `configuration and` and keeps
`secret redaction, `. `AGENTS.md`'s not-implemented list never named configuration, so it is
unchanged.

Both lists have an implemented half, and both are the scope of record, so the same phrase goes into
each: add

```markdown
validated configuration an application declares and injects
```

to `README.md`'s implemented paragraph and to `AGENTS.md`'s, in the enumeration style those
paragraphs already use.

- [ ] **Step 3: Narrow the sentences this change makes false**

Three published places say the framework never reads an environment variable, and this change makes
one read possible — a read the application asks for, through a schema it wrote.
`docs/devtools.md:48-53`, `docs/packages.md:91-93`, and `packages/devtools/AGENTS.md:30-32` each
keep their decision (the framework consults no variable to choose its own behaviour) and gain the
distinction: a declaration an application makes is the application's read, not the framework's. None
of the three is guarded, so a missed edit ships silently.

- [ ] **Step 4: Add the page to the indexes and the package surfaces**

`docs/AGENTS.md`'s published-document table gains a `configuration.md` row after `files.md`.
`README.md`'s navigation list gains `[Configuration](./docs/configuration.md) ·`.
`packages/common/README.md` names `defineConfiguration` and `ConfigurationToken` in its public
surface prose. `packages/platform-elysia/README.md` gains a bullet for `provideConfiguration` and
`AponiaElysiaApplication.get`, and a link to the new page in its link block.

- [ ] **Step 5: Run the documentation gates and commit**

```bash
bun run check --fix
bun test scripts/
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add docs README.md AGENTS.md packages/common/README.md packages/platform-elysia/README.md
git commit -m "docs(configuration): teach the declaration where a reader looks for it"
```

---

## Whole-branch verification

After Task 5, on the branch as a whole:

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
bun run release:dry-run
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
bun run test:generated-app
bun test scripts/
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
```

`test:coverage` fails first if `configuration-loader.ts` or `provider.ts` is imported but never
exercised: `scripts/coverage-gate.ts` discovers runtime sources by glob and requires each in LCOV.
`test:generated-app` is the only lane that reaches the committed descriptor artifact the starter
boots from, so it is run last and read carefully rather than skimmed.

The branch's version bump happens when it is pushed, not before: this plan's tasks commit code and
documents, and `bun run version:alpha` plus the four published snippet stamps are a push-time step.

## What this plan does not do

- **No push and no version bump.** Both belong to the integration, and a push to a release branch
  publishes every package.
- **Nothing about the other three utility documents.** Request context, the http client, and the
  logger seam are separate designs and separate branches; this one touches neither.
- **No secret redaction**, which the spec leaves to the surfaces that hold the values.
- **No new provider kind, scope, or resolution tier.** The configuration provider is a factory
  provider, and `@aponiajs/core` is untouched.
- **No asynchronous validation**, and no factory option that could await one.
