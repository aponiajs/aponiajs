import "reflect-metadata";
import type { PipeType } from "../pipes/pipe.types.ts";
import type { CustomParamFactory } from "./custom-parameter.types.ts";
import { routeParametersMetadataKey } from "./route-parameters.ts";
import type { RouteParameterMetadata } from "./route-parameters.types.ts";

/**
 * Creates a custom route parameter decorator backed by a factory function.
 *
 * @param factory - The factory resolving the parameter value from the request context.
 * @returns A decorator factory accepting optional data and trailing pipes.
 *
 * @example
 * ```ts
 * export const User = createParamDecorator((data: string | undefined, ctx) => {
 *   const user = (ctx as any).user;
 *   return data ? user?.[data] : user;
 * });
 *
 * @Get("me")
 * getMe(@User() user: UserDto, @User("email", ParsePipe) email: string) {}
 * ```
 */
export function createParamDecorator<TData = unknown, TOutput = unknown>(
  factory: CustomParamFactory<TData, TOutput>,
): (dataOrPipe?: TData | PipeType, ...pipes: readonly PipeType[]) => ParameterDecorator {
  return (dataOrPipe?: TData | PipeType, ...pipes: readonly PipeType[]): ParameterDecorator => {
    let data: TData | undefined;
    let resolvedPipes: readonly PipeType[];

    if (
      typeof dataOrPipe === "function" ||
      (typeof dataOrPipe === "object" &&
        dataOrPipe !== null &&
        typeof (dataOrPipe as { transform?: unknown }).transform === "function")
    ) {
      data = undefined;
      resolvedPipes = [dataOrPipe as PipeType, ...pipes];
    } else {
      data = dataOrPipe as TData | undefined;
      resolvedPipes = pipes;
    }

    return (target: object, propertyKey?: string | symbol, parameterIndex?: number): void => {
      if (propertyKey === undefined || parameterIndex === undefined) {
        throw new TypeError(
          "Custom parameter decorator can only decorate a route handler parameter.",
        );
      }

      const parametersByMethod =
        (Reflect.getOwnMetadata(routeParametersMetadataKey, target) as
          | ReadonlyMap<string | symbol, readonly RouteParameterMetadata[]>
          | undefined) ?? new Map<string | symbol, readonly RouteParameterMetadata[]>();
      const methodParameters = parametersByMethod.get(propertyKey) ?? [];
      const updated = new Map(parametersByMethod);

      updated.set(
        propertyKey,
        Object.freeze([
          ...methodParameters,
          Object.freeze({
            index: parameterIndex,
            kind: "custom" as const,
            property: undefined,
            factory: factory as CustomParamFactory<unknown, unknown>,
            data,
            ...(resolvedPipes.length > 0 ? { pipes: Object.freeze([...resolvedPipes]) } : {}),
          }),
        ]),
      );

      Reflect.defineMetadata(routeParametersMetadataKey, updated, target);
    };
  };
}
