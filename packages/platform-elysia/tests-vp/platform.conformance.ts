import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { Elysia } from "elysia";
import { AponiaFactory, type ConfiguredAponiaApplicationOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Injectable()
class HealthService {
  getStatus(): string {
    return "ok";
  }
}

@Controller("health")
class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getStatus(): string {
    return this.healthService.getStatus();
  }
}

@Module({
  providers: [HealthService],
  exports: [HealthService],
})
class HealthServicesModule {}

@Module({
  imports: [HealthServicesModule],
  controllers: [HealthController],
})
class HealthModule {}

function configureNative(nativeApplication: Elysia) {
  return nativeApplication.state("aponiaVersion", "typed" as const);
}

test("the Vite+ lane mounts a controller from module metadata", async () => {
  const options: ConfiguredAponiaApplicationOptions<ReturnType<typeof configureNative>> = {
    logger: false,
    configureNative,
  };
  const application = await AponiaFactory.create(HealthModule, options);
  const response = await application.handle(new Request("http://localhost/health"));

  expect(await response.text()).toBe("ok");
  expect(application.getNativeApplication().store.aponiaVersion).toBe("typed");
  await application.close();
});
