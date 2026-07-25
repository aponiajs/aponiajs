import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

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

test("the Vite+ lane mounts a controller from module metadata", async () => {
  const application = await AponiaFactory.create(HealthModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/health"));

  expect(await response.text()).toBe("ok");
  await application.close();
});
