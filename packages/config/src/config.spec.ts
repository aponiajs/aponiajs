import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AponiaError, Controller, Get, Inject, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { Type } from "typebox";
import { z } from "zod";
import { ConfigModule, ConfigService, getConfigToken, registerAs } from "./index.ts";
import { expandEnvVariables, loadEnvironmentConfig, parseEnvContent } from "./utils/env-loader.ts";

describe("@aponiajs/config", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loads .env files, expands variables, merges registerAs namespaces, and validates with Standard Schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-config-"));
    tempDirs.push(dir);
    const envPath = join(dir, ".env");
    writeFileSync(
      envPath,
      [
        "# comment",
        'HOST="localhost"',
        "PORT=8080",
        "export BASE_URL=http://${HOST}:${PORT}",
        "FALLBACK_URL=${MISSING_VAR:-http://fallback.test}",
      ].join("\n"),
    );

    const appConfig = registerAs("app", () => ({
      name: "aponia-service",
      port: 8080,
    }));

    @Controller("cfg")
    class CfgController {
      constructor(
        private readonly config: ConfigService,
        @Inject(appConfig.KEY) private readonly app: { readonly name: string },
      ) {}

      @Get("/")
      read() {
        return {
          baseUrl: this.config.getOrThrow<string>("BASE_URL"),
          fallback: this.config.get<string>("FALLBACK_URL"),
          appName: this.config.get<string>("app.name"),
          injectedName: this.app.name,
          withDefault: this.config.get("NON_EXISTENT", "default-val"),
        };
      }
    }

    @Module({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [envPath, join(dir, ".env.missing")],
          expandVariables: true,
          cache: true,
          skipProcessEnv: true,
          load: [appConfig, () => ({ EXTRA_FLAG: "yes" })],
          validationSchema: z
            .object({
              BASE_URL: z.string().url(),
              PORT: z.coerce.number().int(),
            })
            .passthrough(),
        }),
      ],
      controllers: [CfgController],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });
    try {
      const response = await app.handle(new Request("http://localhost/cfg"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        baseUrl: "http://localhost:8080",
        fallback: "http://fallback.test",
        appName: "aponia-service",
        injectedName: "aponia-service",
        withDefault: "default-val",
      });

      const service = app.get(ConfigService);
      expect(service.get("BASE_URL")).toBe("http://localhost:8080");
      expect(() => service.getOrThrow("MISSING_KEY")).toThrow(AponiaError);
    } finally {
      await app.close();
    }
  });

  test("supports forRootAsync, forFeature, registerAs.asProvider(), and TypeBox validation", async () => {
    const dbConfig = registerAs("db", () => ({ host: "127.0.0.1" }));
    expect(dbConfig.KEY).toBe(getConfigToken("db"));
    expect(dbConfig.asProvider().provide).toBe(dbConfig.KEY);

    @Module({
      imports: [
        ConfigModule.forRootAsync({
          isGlobal: true,
          useFactory: async () => ({
            ignoreEnvFile: true,
            ignoreEnvVars: true,
            validate: (cfg) => ({ ...cfg, SERVICE_NAME: "async-svc", PORT: 3000 }),
            validationSchema: Type.Object({
              SERVICE_NAME: Type.String(),
              PORT: Type.Number(),
            }),
          }),
        }),
        ConfigModule.forFeature(dbConfig),
      ],
    })
    class AppModule {}

    const app = await AponiaFactory.createApplicationContext(AppModule, { logger: false });
    try {
      const service = app.get(ConfigService);
      expect(service.getOrThrow("SERVICE_NAME")).toBe("async-svc");
    } finally {
      await app.close();
    }
  });

  test("rejects invalid Standard Schema and TypeBox configurations with INVALID_CONFIGURATION_VALUE", async () => {
    @Module({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          validationSchema: z.object({ REQUIRED_KEY: z.string() }),
        }),
      ],
    })
    class InvalidZodModule {}

    let zodError: unknown;
    try {
      await AponiaFactory.createApplicationContext(InvalidZodModule, { logger: false });
    } catch (error) {
      zodError = error;
    }
    expect((zodError as AponiaError).code).toBe("INVALID_CONFIGURATION_VALUE");

    @Module({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          validationSchema: Type.Object({ REQUIRED_KEY: Type.String() }),
        }),
      ],
    })
    class InvalidTypeBoxModule {}

    let tbError: unknown;
    try {
      await AponiaFactory.createApplicationContext(InvalidTypeBoxModule, { logger: false });
    } catch (error) {
      tbError = error;
    }
    expect((tbError as AponiaError).code).toBe("INVALID_CONFIGURATION_VALUE");

    expect(parseEnvContent("INVALID_LINE\nA='single'")).toEqual({ A: "single" });
    expect(expandEnvVariables({ EMPTY_VAR: "${MISSING_VAR}" }, {})).toEqual({ EMPTY_VAR: "" });
  });

  test("handles default envFilePath, string envFilePath, process.env population, and invalid schema errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-config-loader-"));
    tempDirs.push(dir);
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "APONIA_TEST_LOADER_VAR=loaded\n");

    try {
      delete process.env.APONIA_TEST_LOADER_VAR;
      const defaultLoaded = await loadEnvironmentConfig({ ignoreEnvVars: true });
      expect(defaultLoaded).toEqual({});

      const singlePathLoaded = await loadEnvironmentConfig({
        envFilePath: envPath,
        ignoreEnvVars: true,
        skipProcessEnv: false,
      });
      expect(singlePathLoaded).toEqual({ APONIA_TEST_LOADER_VAR: "loaded" });
      expect(process.env["APONIA_TEST_LOADER_VAR"] as string | undefined).toBe("loaded");
    } finally {
      delete process.env.APONIA_TEST_LOADER_VAR;
    }

    let invalidSchemaError: unknown;
    try {
      await loadEnvironmentConfig({
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        validationSchema: { invalid: true } as never,
      });
    } catch (error) {
      invalidSchemaError = error;
    }
    expect(invalidSchemaError).toBeInstanceOf(AponiaError);
    expect((invalidSchemaError as AponiaError).code).toBe("INVALID_CONFIGURATION");
  });
});
