import { Module, provideFactory, provideValue, type DynamicModule } from "@aponiajs/common";
import { HealthCheckService } from "./health-check/health-check.service.ts";
import { DiskHealthIndicator } from "./health-indicators/disk-health.service.ts";
import { HealthIndicatorService } from "./health-indicators/health-indicator.service.ts";
import { HttpHealthIndicator } from "./health-indicators/http-health.service.ts";
import { MemoryHealthIndicator } from "./health-indicators/memory-health.service.ts";
import type {
  TerminusModuleAsyncOptions,
  TerminusModuleOptions,
} from "./interfaces/terminus.interface.ts";

const TERMINUS_MODULE_OPTIONS = Symbol.for("aponia.terminus.options");

const indicatorProviders = [
  HealthCheckService,
  HealthIndicatorService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
] as const;

/**
 * Nest-compatible `TerminusModule` providing `HealthCheckService` and built-in indicators.
 */
@Module({ providers: [...indicatorProviders], exports: [...indicatorProviders] })
export class TerminusModule {
  /** Registers `TerminusModule` with synchronous options. */
  static forRoot(options: TerminusModuleOptions = {}): DynamicModule {
    return Object.freeze({
      id: "TerminusModule",
      instanceId: Symbol("TerminusModule.forRoot"),
      module: TerminusModule,
      providers: Object.freeze([provideValue(TERMINUS_MODULE_OPTIONS, options)]),
    });
  }

  /** Registers `TerminusModule` with asynchronous options. */
  static forRootAsync(options: TerminusModuleAsyncOptions): DynamicModule {
    return Object.freeze({
      id: "TerminusModule",
      instanceId: Symbol("TerminusModule.forRootAsync"),
      module: TerminusModule,
      imports: options.imports ?? [],
      providers: Object.freeze([
        provideFactory(TERMINUS_MODULE_OPTIONS, options.inject ?? [], (...args) =>
          options.useFactory(...(args as unknown as readonly never[])),
        ),
      ]),
    });
  }
}
