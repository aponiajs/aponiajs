# @aponiajs/cqrs — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

Nest-compatible CQRS primitives without RxJS: `CqrsModule`, `CommandBus`,
`QueryBus`, `EventBus`, `@CommandHandler()`, `@QueryHandler()`,
`@EventsHandler()`, `@Saga()`, `AggregateRoot`, and `EventPublisher`.
