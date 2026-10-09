import "reflect-metadata";
import { pipeMetadataKey } from "./pipe.constants.ts";
import type { PipeType } from "./pipe.types.ts";

/**
 * Applies one or more pipes to a controller class or a route handler method.
 *
 * @param pipes - The pipes or pipe constructors to apply.
 * @returns A decorator recording the pipe metadata.
 *
 * @example
 * ```ts
 * @UsePipes(ValidationPipe)
 * @Post()
 * create(@Body() dto: CreateUserDto) {}
 * ```
 */
export function UsePipes(...pipes: readonly PipeType[]): ClassDecorator & MethodDecorator {
  const frozenPipes = Object.freeze([...pipes]);
  return ((
    target: object,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ): void => {
    if (propertyKey !== undefined) {
      if (
        (descriptor?.value && typeof descriptor.value === "object") ||
        typeof descriptor?.value === "function"
      ) {
        Reflect.defineMetadata(pipeMetadataKey, frozenPipes, descriptor.value as object);
      }
      Reflect.defineMetadata(pipeMetadataKey, frozenPipes, target, propertyKey);
    } else {
      Reflect.defineMetadata(pipeMetadataKey, frozenPipes, target);
    }
  }) as ClassDecorator & MethodDecorator;
}

/**
 * Retrieves the pipes recorded on a method or controller class.
 *
 * @param target - The method function, prototype, or controller constructor.
 * @param propertyKey - Optional method name when reading off a prototype.
 * @returns The frozen list of pipes, or undefined.
 */
export function getPipesMetadata(
  target: object,
  propertyKey?: string | symbol,
): readonly PipeType[] | undefined {
  if (propertyKey !== undefined) {
    return Reflect.getMetadata(pipeMetadataKey, target, propertyKey) as
      | readonly PipeType[]
      | undefined;
  }
  return Reflect.getMetadata(pipeMetadataKey, target) as readonly PipeType[] | undefined;
}
