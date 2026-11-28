import { describe, expect, test } from "vite-plus/test";
import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { ConfigModule, ConfigService, registerAs } from "@aponiajs/config";

describe("@aponiajs/config conformance", () => {
  test("provides ConfigService and registerAs namespaces through AponiaFactory", async () => {
    const featureConfig = registerAs("feature", () => ({ enabled: true }));

    @Module({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [featureConfig],
        }),
      ],
    })
    class AppModule {}

    const app = await AponiaFactory.createApplicationContext(AppModule, { logger: false });
    try {
      const service = app.get(ConfigService);
      expect(service.get("feature.enabled")).toBe(true);
    } finally {
      await app.close();
    }
  });
});
