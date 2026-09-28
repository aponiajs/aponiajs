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

  test("refuses a declaration whose Standard Schema cannot validate", async () => {
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
