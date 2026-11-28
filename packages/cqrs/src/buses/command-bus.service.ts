import { AponiaError, Injectable, type ClassToken } from "@aponiajs/common";
import type { ICommand, ICommandHandler } from "../interfaces/cqrs.interface.ts";

/**
 * Dispatches commands to their registered `@CommandHandler()` implementation.
 */
@Injectable()
export class CommandBus<TCommandBase extends ICommand = ICommand> {
  readonly #handlers = new Map<ClassToken<unknown>, ICommandHandler<TCommandBase, unknown>>();

  /** Registers a command handler instance for `commandType`. */
  registerHandler(
    commandType: ClassToken<unknown>,
    handler: ICommandHandler<TCommandBase, unknown>,
  ): void {
    this.#handlers.set(commandType, handler);
  }

  /**
   * Executes `command` by invoking its registered handler.
   *
   * @throws `AponiaError` (`MISSING_PROVIDER`) when no handler is registered for the command.
   */
  async execute<TResult = unknown>(command: TCommandBase): Promise<TResult> {
    const commandType = (command as unknown as { constructor: ClassToken<unknown> }).constructor;
    const handler = this.#handlers.get(commandType);
    if (handler === undefined) {
      throw new AponiaError(
        "MISSING_PROVIDER",
        `No command handler registered for "${commandType.name}".`,
        { command: commandType.name },
      );
    }
    return (await handler.execute(command)) as TResult;
  }
}
