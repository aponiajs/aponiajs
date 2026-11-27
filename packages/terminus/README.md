# @aponiajs/terminus

Nest-compatible Terminus health checks and indicators for AponiaJS.

## Usage

```ts
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
  TerminusModule,
} from "@aponiajs/terminus";

@Controller("health")
class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkHeap("memory_heap", 512 * 1024 * 1024),
      () => this.disk.checkStorage("storage", { path: "/", thresholdPercent: 0.99 }),
      () => this.http.pingCheck("self", "http://localhost:3000/health"),
    ]);
  }
}

@Module({
  imports: [TerminusModule.forRoot()],
  controllers: [HealthController],
})
class AppModule {}

const app = await AponiaFactory.create(AppModule);
```
