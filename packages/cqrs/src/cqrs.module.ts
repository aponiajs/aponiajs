import { Module, type DynamicModule } from "@aponiajs/common";
import { EventPublisher } from "./aggregate-root.ts";
import { CommandBus } from "./buses/command-bus.service.ts";
import { EventBus } from "./buses/event-bus.service.ts";
import { QueryBus } from "./buses/query-bus.service.ts";
import { CqrsExplorer } from "./cqrs.explorer.ts";
import type { CqrsModuleOptions } from "./interfaces/cqrs.interface.ts";

const cqrsExports = [CommandBus, QueryBus, EventBus, EventPublisher] as const;
const cqrsProviders = [...cqrsExports, CqrsExplorer] as const;

/**
 * Nest-compatible `CqrsModule` providing `CommandBus`, `QueryBus`, `EventBus`,
 * `EventPublisher`, and automatic discovery of CQRS handlers and sagas.
 */
@Module({ providers: [...cqrsProviders], exports: [...cqrsExports] })
export class CqrsModule {
  /** Registers `CqrsModule` (global by default, matching `@nestjs/cqrs`). */
  static forRoot(options: CqrsModuleOptions = {}): DynamicModule {
    return Object.freeze({
      id: "CqrsModule",
      instanceId: Symbol("CqrsModule.forRoot"),
      module: CqrsModule,
      global: options.isGlobal ?? true,
    });
  }
}
