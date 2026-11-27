import { Inject, Injectable, ModuleRef, type OnModuleInit } from "@aponiajs/common";
import { CommandBus } from "./buses/command-bus.service.ts";
import { EventBus } from "./buses/event-bus.service.ts";
import { QueryBus } from "./buses/query-bus.service.ts";
import { getRegisteredCommandHandlers } from "./decorators/command-handler.decorator.ts";
import { getRegisteredEventsHandlers } from "./decorators/events-handler.decorator.ts";
import { getRegisteredQueryHandlers } from "./decorators/query-handler.decorator.ts";
import { getRegisteredSagas } from "./decorators/saga.decorator.ts";
import type {
  ICommand,
  ICommandHandler,
  IEvent,
  IEventHandler,
  IQuery,
  IQueryHandler,
  ISaga,
} from "./interfaces/cqrs.interface.ts";

/**
 * Discovers `@CommandHandler`, `@QueryHandler`, `@EventsHandler`, and `@Saga`
 * providers registered in the container and wires them to the buses on module init.
 */
@Injectable()
export class CqrsExplorer implements OnModuleInit {
  readonly #moduleRef: ModuleRef;
  readonly #commandBus: CommandBus;
  readonly #queryBus: QueryBus;
  readonly #eventBus: EventBus;

  constructor(
    @Inject(ModuleRef) moduleRef: ModuleRef,
    commandBus: CommandBus,
    queryBus: QueryBus,
    eventBus: EventBus,
  ) {
    this.#moduleRef = moduleRef;
    this.#commandBus = commandBus;
    this.#queryBus = queryBus;
    this.#eventBus = eventBus;
  }

  onModuleInit(): void {
    for (const [handlerClass, commandClass] of getRegisteredCommandHandlers()) {
      const instance = this.#resolveOptional<ICommandHandler<ICommand, unknown>>(handlerClass);
      if (instance !== undefined) {
        this.#commandBus.registerHandler(commandClass, instance);
      }
    }

    for (const [handlerClass, queryClass] of getRegisteredQueryHandlers()) {
      const instance = this.#resolveOptional<IQueryHandler<IQuery, unknown>>(handlerClass);
      if (instance !== undefined) {
        this.#queryBus.registerHandler(queryClass, instance);
      }
    }

    for (const [handlerClass, eventClasses] of getRegisteredEventsHandlers()) {
      const instance = this.#resolveOptional<IEventHandler<IEvent>>(handlerClass);
      if (instance !== undefined) {
        for (const eventClass of eventClasses) {
          this.#eventBus.registerHandler(eventClass, instance);
        }
      }
    }

    for (const [sagaClass, propertyKeys] of getRegisteredSagas()) {
      const instance = this.#resolveOptional<Record<string | symbol, unknown>>(sagaClass);
      if (instance === undefined) {
        continue;
      }
      for (const key of propertyKeys) {
        const method = instance[key];
        if (typeof method === "function") {
          this.#eventBus.registerSaga((events) =>
            (method as ISaga<IEvent, ICommand>).call(instance, events),
          );
        }
      }
    }
  }

  #resolveOptional<T>(token: Parameters<ModuleRef["get"]>[0]): T | undefined {
    try {
      return this.#moduleRef.get(token, { strict: false }) as T;
    } catch {
      return undefined;
    }
  }
}
