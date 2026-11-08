import { Module, provideClass, type DynamicModule } from "@aponiajs/common";
import { EventEmitter } from "../emitter/event-emitter.ts";

/**
 * Provides one in-process event emitter.
 *
 * An application normally registers it once. The emitter is exported, so
 * `application.get(EventEmitter)` reads the same instance providers inject.
 */
@Module({})
export class EventEmitterModule {
  /** Builds the emitter registration. */
  static register(): DynamicModule {
    return Object.freeze({
      module: EventEmitterModule,
      id: "EventEmitterModule",
      instanceId: Symbol("EventEmitterModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([provideClass(EventEmitter, [])]),
      exports: Object.freeze([EventEmitter]),
    });
  }
}
