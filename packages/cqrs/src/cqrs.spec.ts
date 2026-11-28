import { describe, expect, test } from "bun:test";
import { AponiaError, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  AggregateRoot,
  CommandBus,
  CommandHandler,
  CqrsModule,
  EventBus,
  EventPublisher,
  EventsHandler,
  QueryBus,
  QueryHandler,
  Saga,
  type ICommand,
  type ICommandHandler,
  type IEvent,
  type IEventHandler,
  type IQueryHandler,
} from "./index.ts";

class CreateOrderCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

class NotifyOrderCommand implements ICommand {
  constructor(public readonly orderId: string) {}
}

class GetOrderQuery {
  constructor(public readonly orderId: string) {}
}

class OrderCreatedEvent implements IEvent {
  constructor(public readonly orderId: string) {}
}

describe("@aponiajs/cqrs", () => {
  test("executes commands, queries, events, sagas, and AggregateRoot commits", async () => {
    const log: string[] = [];

    @CommandHandler(CreateOrderCommand)
    class CreateOrderHandler implements ICommandHandler<CreateOrderCommand, string> {
      async execute(command: CreateOrderCommand): Promise<string> {
        log.push(`cmd:${command.orderId}`);
        return command.orderId;
      }
    }

    @CommandHandler(NotifyOrderCommand)
    class NotifyOrderHandler implements ICommandHandler<NotifyOrderCommand, void> {
      execute(command: NotifyOrderCommand): void {
        log.push(`saga-cmd:${command.orderId}`);
      }
    }

    @QueryHandler(GetOrderQuery)
    class GetOrderHandler implements IQueryHandler<GetOrderQuery, { id: string }> {
      execute(query: GetOrderQuery) {
        return { id: query.orderId };
      }
    }

    @EventsHandler(OrderCreatedEvent)
    class OrderCreatedHandler implements IEventHandler<OrderCreatedEvent> {
      handle(event: OrderCreatedEvent): void {
        log.push(`event:${event.orderId}`);
      }
    }

    @Injectable()
    class OrderSagas {
      @Saga()
      async *onOrderCreated(events: AsyncIterable<IEvent>) {
        for await (const event of events) {
          if (event instanceof OrderCreatedEvent) {
            yield new NotifyOrderCommand(event.orderId);
          }
        }
      }
    }

    class OrderAggregate extends AggregateRoot {
      readonly applied: string[] = [];

      create(orderId: string): void {
        this.apply(new OrderCreatedEvent(orderId));
      }

      onOrderCreatedEvent(event: OrderCreatedEvent): void {
        this.applied.push(event.orderId);
      }
    }

    @Module({
      imports: [CqrsModule.forRoot()],
      providers: [
        CreateOrderHandler,
        NotifyOrderHandler,
        GetOrderHandler,
        OrderCreatedHandler,
        OrderSagas,
      ],
    })
    class AppModule {}

    const app = await AponiaFactory.createApplicationContext(AppModule, { logger: false });
    try {
      const commandBus = app.get(CommandBus);
      const queryBus = app.get(QueryBus);
      const eventBus = app.get(EventBus);
      const publisher = app.get(EventPublisher);

      expect(await commandBus.execute(new CreateOrderCommand("ord-1"))).toBe("ord-1");
      expect(await queryBus.execute(new GetOrderQuery("ord-1"))).toEqual({ id: "ord-1" });

      const aggregate = publisher.mergeObjectContext(new OrderAggregate());
      aggregate.create("ord-1");
      expect(aggregate.getUncommittedEvents()).toHaveLength(1);
      await aggregate.commit();
      expect(aggregate.getUncommittedEvents()).toHaveLength(0);
      expect(aggregate.applied).toEqual(["ord-1"]);

      // Wait briefly for microtask saga dispatch
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(log).toContain("cmd:ord-1");
      expect(log).toContain("event:ord-1");
      expect(log).toContain("saga-cmd:ord-1");

      const controller = new AbortController();
      const collected: string[] = [];
      const reader = (async () => {
        for await (const ev of eventBus.ofType(OrderCreatedEvent, controller.signal)) {
          collected.push(ev.orderId);
          controller.abort();
        }
      })();
      await eventBus.publish(new OrderCreatedEvent("ord-2"));
      await reader;
      expect(collected).toEqual(["ord-2"]);

      aggregate.loadFromHistory([new OrderCreatedEvent("ord-hist")]);
      expect(aggregate.getUncommittedEvents()).toHaveLength(0);
      aggregate.uncommit();
    } finally {
      await app.close();
    }
  });

  test("throws MISSING_PROVIDER when executing an unregistered command or query", async () => {
    class UnknownCommand implements ICommand {}
    class UnknownQuery {}

    @Module({ imports: [CqrsModule.forRoot()] })
    class EmptyModule {}

    const app = await AponiaFactory.createApplicationContext(EmptyModule, { logger: false });
    try {
      let cmdError: unknown;
      try {
        await app.get(CommandBus).execute(new UnknownCommand());
      } catch (error) {
        cmdError = error;
      }
      expect(cmdError).toBeInstanceOf(AponiaError);

      let queryError: unknown;
      try {
        await app.get(QueryBus).execute(new UnknownQuery());
      } catch (error) {
        queryError = error;
      }
      expect(queryError).toBeInstanceOf(AponiaError);
    } finally {
      await app.close();
    }
  });
});
