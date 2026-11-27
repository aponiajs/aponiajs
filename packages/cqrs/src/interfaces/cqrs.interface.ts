import type { ClassToken } from "@aponiajs/common";

/** Marker interface for a CQRS command. */
export interface ICommand {}

/** Marker interface for a CQRS query. */
export interface IQuery {}

/** Marker interface for a CQRS domain event. */
export interface IEvent {}

/** Handler for a single command type. */
export interface ICommandHandler<TCommand extends ICommand = ICommand, TResult = unknown> {
  execute(command: TCommand): Promise<TResult> | TResult;
}

/** Handler for a single query type. */
export interface IQueryHandler<TQuery extends IQuery = IQuery, TResult = unknown> {
  execute(query: TQuery): Promise<TResult> | TResult;
}

/** Handler for one or more event types. */
export interface IEventHandler<TEvent extends IEvent = IEvent> {
  handle(event: TEvent): unknown;
}

/**
 * Saga function receiving an `AsyncIterable` stream of domain events and
 * yielding commands (or `undefined`) to dispatch on `CommandBus`.
 */
export type ISaga<TEvent extends IEvent = IEvent, TCommand extends ICommand = ICommand> = (
  events: AsyncIterable<TEvent>,
) => AsyncIterable<TCommand | undefined>;

/** Options accepted by `CqrsModule.forRoot()`. */
export interface CqrsModuleOptions {
  /** Registers `CqrsModule` as a global module (default: `true`). */
  readonly isGlobal?: boolean;
}

/** Registry entry pairing a handler class with its command/query/event constructor. */
export interface CqrsHandlerRegistration {
  readonly handlerClass: ClassToken<unknown>;
  readonly targets: readonly ClassToken<unknown>[];
}
