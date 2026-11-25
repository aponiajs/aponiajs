import { Module, provideClass, provideValue, type DynamicModule } from "@aponiajs/common";
import { EventEmitter } from "./event-emitter.ts";
import { EVENT_EMITTER_MODULE_OPTIONS } from "./events.constants.ts";

/**
 * Provides one in-process event emitter.
 *
 * An application normally registers it once. The emitter is exported, so
 * `application.get(EventEmitter)` reads the same instance providers inject.
 *
 * The registration takes no options in this release, so `forRoot()` is the whole
 * contract and there is no asynchronous form to add. It is global by default, as
 * `@nestjs/event-emitter` is: a listener module and the module that emits are
 * normally different modules, and neither imports the other.
 */
@Module({})
export class EventEmitterModule {
  /**
   * Builds the emitter registration.
   *
   * @returns A frozen dynamic module an application imports.
   */
  static forRoot(): DynamicModule {
    return Object.freeze({
      module: EventEmitterModule,
      id: "EventEmitterModule",
      instanceId: Symbol("EventEmitterModule"),
      global: true,
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([
        provideValue(EVENT_EMITTER_MODULE_OPTIONS, Object.freeze({})),
        provideClass(EventEmitter, []),
      ]),
      exports: Object.freeze([EVENT_EMITTER_MODULE_OPTIONS, EventEmitter]),
    });
  }

  /**
   * Builds the emitter registration.
   *
   * @deprecated Use {@link EventEmitterModule.forRoot}; retained for the beta line.
   */
  static register(): DynamicModule {
    return EventEmitterModule.forRoot();
  }
}
