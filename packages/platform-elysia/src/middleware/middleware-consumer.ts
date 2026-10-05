import type {
  AponiaMiddleware,
  ClassToken,
  MiddlewareConfigProxy,
  MiddlewareConsumer,
  RequestMethod,
  RouteTarget,
} from "@aponiajs/common";
import type { ResolvedMiddlewareConfig } from "./middleware-consumer.types.ts";

/**
 * Creates an empty middleware consumer and returns the consumer plus its collected configurations.
 *
 * @returns The consumer and the mutable configs list.
 */
export function createMiddlewareConsumer(): {
  readonly consumer: MiddlewareConsumer;
  readonly getConfigs: () => readonly ResolvedMiddlewareConfig[];
} {
  const configs: ResolvedMiddlewareConfig[] = [];

  const consumer: MiddlewareConsumer = {
    apply(
      ...middleware: readonly (ClassToken<AponiaMiddleware> | AponiaMiddleware)[]
    ): MiddlewareConfigProxy {
      const excluded: (string | { readonly path: string; readonly method?: RequestMethod })[] = [];

      const proxy: MiddlewareConfigProxy = {
        exclude(
          ...routes: readonly (
            | string
            | { readonly path: string; readonly method?: RequestMethod }
          )[]
        ): MiddlewareConfigProxy {
          excluded.push(...routes);
          return proxy;
        },
        forRoutes(...targets: readonly RouteTarget[]): MiddlewareConsumer {
          configs.push(
            Object.freeze({
              middleware: Object.freeze([...middleware]),
              targets: Object.freeze([...targets]),
              excluded: Object.freeze([...excluded]),
            }),
          );
          return consumer;
        },
      };

      return proxy;
    },
  };

  return Object.freeze({
    consumer,
    getConfigs: () => Object.freeze([...configs]),
  });
}
