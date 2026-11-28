# @aponiajs/cqrs

Nest-compatible CQRS module (`CommandBus`, `QueryBus`, `EventBus`, `@Saga()`, `AggregateRoot`) for AponiaJS without RxJS.

## Usage

```ts
import { Module } from "@aponiajs/common";
import { CommandBus, CommandHandler, CqrsModule, type ICommandHandler } from "@aponiajs/cqrs";
import { AponiaFactory } from "@aponiajs/platform-elysia";

class CreateItemCommand {
  constructor(public readonly name: string) {}
}

@CommandHandler(CreateItemCommand)
class CreateItemHandler implements ICommandHandler<CreateItemCommand, string> {
  async execute(command: CreateItemCommand): Promise<string> {
    return `created:${command.name}`;
  }
}

@Module({
  imports: [CqrsModule.forRoot()],
  providers: [CreateItemHandler],
})
class AppModule {}

const app = await AponiaFactory.createApplicationContext(AppModule, { logger: false });
const result = await app.get(CommandBus).execute(new CreateItemCommand("widget"));
```
