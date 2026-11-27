import type { ClassToken } from "@aponiajs/common";

const commandHandlerRegistry = new Map<ClassToken<unknown>, ClassToken<unknown>>();

/**
 * Marks a class as the handler for `command`.
 *
 * @param command - Command class handled by the decorated class.
 */
export function CommandHandler(command: ClassToken<unknown>): ClassDecorator {
  return (target) => {
    commandHandlerRegistry.set(target as unknown as ClassToken<unknown>, command);
  };
}

/** Returns all `@CommandHandler()` class-to-command registrations. */
export function getRegisteredCommandHandlers(): ReadonlyMap<
  ClassToken<unknown>,
  ClassToken<unknown>
> {
  return commandHandlerRegistry;
}
