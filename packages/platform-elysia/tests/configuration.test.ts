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
// The loader is package-private and `defineConfiguration` always supplies a
// description, so the name fallback is reachable only by calling it directly.
import { loadConfiguration } from "../src/configuration/configuration-loader.ts";

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

  test("reads the process environment, and prefers an explicit source to it", async () => {
    const environmentSchema = z.object({
      APONIA_TEST_CONFIG_PORT: z.coerce.number().int().positive().default(3000),
    });
    const AppConfig = defineConfiguration(environmentSchema, "app.config");
    const previous = process.env.APONIA_TEST_CONFIG_PORT;
    process.env.APONIA_TEST_CONFIG_PORT = "4321";
    let fromEnvironment: { APONIA_TEST_CONFIG_PORT: number } | undefined;
    let fromSource: { APONIA_TEST_CONFIG_PORT: number } | undefined;

    @Injectable()
    class EnvironmentReader {
      constructor(@Inject(AppConfig) readonly config: { APONIA_TEST_CONFIG_PORT: number }) {
        fromEnvironment = config;
      }
    }

    @Module({ providers: [provideConfiguration(AppConfig), EnvironmentReader] })
    class EnvironmentModule {}

    @Injectable()
    class SourceReader {
      constructor(@Inject(AppConfig) readonly config: { APONIA_TEST_CONFIG_PORT: number }) {
        fromSource = config;
      }
    }

    @Module({
      providers: [
        provideConfiguration(AppConfig, { source: { APONIA_TEST_CONFIG_PORT: "5000" } }),
        SourceReader,
      ],
    })
    class SourceModule {}

    try {
      const environmentBoot = await AponiaFactory.create(EnvironmentModule, { logger: false });
      const sourceBoot = await AponiaFactory.create(SourceModule, { logger: false });

      try {
        // The schema declares a default, so only a real environment read answers 4321.
        expect(fromEnvironment).toEqual({ APONIA_TEST_CONFIG_PORT: 4321 });
        // The environment still holds 4321 here, so only a real override answers 5000.
        expect(fromSource).toEqual({ APONIA_TEST_CONFIG_PORT: 5000 });
      } finally {
        await environmentBoot.close();
        await sourceBoot.close();
      }
    } finally {
      if (previous === undefined) {
        delete process.env.APONIA_TEST_CONFIG_PORT;
      } else {
        process.env.APONIA_TEST_CONFIG_PORT = previous;
      }
    }
  });

  test("injects the validator's own output object rather than a copy of it", async () => {
    const output = { port: 4000 };
    const passthrough = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({ value: output }),
      },
    };
    const AppConfig = defineConfiguration(passthrough as never, "app.config");
    let resolved: { port: number } | undefined;

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: { port: number }) {
        resolved = config;
      }
    }

    @Module({ providers: [provideConfiguration(AppConfig, { source: {} }), Reader] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });

    expect(resolved).toBe(output);
    expect(resolved).toEqual({ port: 4000 });
    // The design settles that the value belongs to the application: not copied,
    // not frozen. Freezing keeps the same reference, so `toBe` cannot see this.
    expect(Object.isFrozen(resolved)).toBe(false);
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

  test("refuses a declaration whose schema is not an object at all", async () => {
    // The first guard's other two disjuncts: a primitive is not an object, and
    // `typeof null` is "object", so null needs a check of its own.
    for (const schema of [null, undefined, "a standard schema", 42]) {
      const notASchema = defineConfiguration(schema as never, "app.config");

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
    }
  });

  test("names a token a JavaScript caller built by hand", () => {
    const handBuilt = {
      schema: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: () => ({ issues: [{ message: "refused" }] }),
        },
      },
    };

    let thrown: unknown;
    try {
      loadConfiguration(handBuilt as never, { source: {} });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION_VALUE");
    expect((thrown as AponiaError).details).toMatchObject({ configuration: "configuration" });
  });

  test("refuses a schema whose ~standard member is not an object", async () => {
    // The membership test alone is not enough: `{ "~standard": null }` passes it
    // and then throws reading `.validate`, which is the failure class the guard
    // exists to prevent.
    const broken = defineConfiguration({ "~standard": null } as unknown as z.ZodType, "app.config");

    @Module({ providers: [provideConfiguration(broken, { source: {} })] })
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

  test("refuses a schema whose ~standard member cannot validate", async () => {
    const brokenValidator = defineConfiguration(
      { "~standard": { version: 1, vendor: "test", validate: "nope" } } as never,
      "app.config",
    );

    @Module({ providers: [provideConfiguration(brokenValidator, { source: {} })] })
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

  test("refuses a validator that answers with null", async () => {
    const answerless = {
      "~standard": { version: 1, vendor: "test", validate: () => null },
    };
    const AppConfig = defineConfiguration(answerless as never, "app.config");

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
      reason: "not-a-standard-schema",
    });
  });

  test("refuses a validator that answers with a primitive", async () => {
    const answerless = {
      "~standard": { version: 1, vendor: "test", validate: () => 42 },
    };
    const AppConfig = defineConfiguration(answerless as never, "app.config");

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
      reason: "not-a-standard-schema",
    });
  });

  test("refuses a validator that answers with neither a value nor issues", async () => {
    const answerless = {
      "~standard": { version: 1, vendor: "test", validate: () => ({}) },
    };
    const AppConfig = defineConfiguration(answerless as never, "app.config");

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
      reason: "not-a-standard-schema",
    });
  });

  test("refuses a validator that answers with an undefined issues key", async () => {
    // A key carrying nothing is the same protocol violation as no key at all:
    // it otherwise injects `undefined` as the configuration.
    const answerless = {
      "~standard": { version: 1, vendor: "test", validate: () => ({ issues: undefined }) },
    };
    const AppConfig = defineConfiguration(answerless as never, "app.config");

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

  test("refuses a thenable that carries no catch", async () => {
    // The promise guard accepts any thenable, so observing the refusal must not
    // assume the value it observed is a promise.
    // The thenable is the input under test, so the rule that refuses to add one
    // is the one thing this case cannot obey.
    // oxlint-disable-next-line unicorn/no-thenable -- a thenable that is not a promise is the input under test
    const thenableAnswer = Object.fromEntries([["then", () => undefined]]);
    const thenable = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => thenableAnswer,
      },
    };
    const AppConfig = defineConfiguration(thenable as never, "app.config");

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

  test("observes a rejected promise rather than abandoning it", async () => {
    const rejecting = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => Promise.reject(new Error("the schema refused its own answer")),
      },
    };
    const AppConfig = defineConfiguration(rejecting as never, "app.config");
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", record);

    @Module({ providers: [provideConfiguration(AppConfig, { source: {} })] })
    class AppModule {}

    let thrown: unknown;
    try {
      await AponiaFactory.create(AppModule, { logger: false });
    } catch (error) {
      thrown = error;
    }

    // A macrotask turn: a rejection nothing observed is reported once the
    // microtask queue drains, so this is the moment it would surface.
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", record);

    expect(codeOf(thrown)).toBe("INVALID_CONFIGURATION");
    expect((thrown as AponiaError).details).toMatchObject({
      configuration: "app.config",
      reason: "asynchronous-validation",
    });
    expect(unhandled).toEqual([]);
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

  test("validates a copy of the source, so a later change to it cannot reach the value", async () => {
    const passthrough = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
      },
    };
    const AppConfig = defineConfiguration(passthrough as never, "app.config");
    const source: Record<string, unknown> = { port: "5000" };
    let resolved: Record<string, unknown> | undefined;

    @Injectable()
    class Reader {
      constructor(@Inject(AppConfig) readonly config: Record<string, unknown>) {
        resolved = config;
      }
    }

    @Module({ providers: [provideConfiguration(AppConfig, { source }), Reader] })
    class AppModule {}

    const application = await AponiaFactory.create(AppModule, { logger: false });
    source.port = "6000";

    // The schema hands back what it validated, so only a copy keeps the value
    // the boot validated rather than whatever the caller did to it afterwards.
    expect(resolved).toEqual({ port: "5000" });
    expect(resolved).not.toBe(source);
    await application.close();
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
