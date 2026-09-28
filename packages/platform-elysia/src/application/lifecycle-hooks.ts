import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "@aponiajs/common";

/** The contract a hook name belongs to, for the type of the collected callables. */
export type LifecycleHookContract =
  | OnModuleInit
  | OnApplicationBootstrap
  | OnModuleDestroy
  | BeforeApplicationShutdown
  | OnApplicationShutdown;

/** One callable per hooked instance, already bound. */
export type LifecycleCall = () => void | Promise<void>;

/**
 * The member names one contract contributes, gathered member by member.
 *
 * `keyof` a union is the intersection of its members' keys, and no two of the
 * five contracts share a member name, so `keyof LifecycleHookContract` alone is
 * `never`. Distributing over the union is what yields the five names, and it
 * keeps them derived from the contracts rather than restated beside them, so a
 * renamed or removed contract member fails `bun run check` at every call site.
 */
type LifecycleHookName<T> = T extends unknown ? keyof T : never;

/**
 * The hook an instance declares, if it declares one.
 *
 * The check is the instance's own, which is the mechanism this package already
 * uses for an interceptor's halves: a method written as a class field is an own
 * property of the instance and of no token, so reading it anywhere else would
 * skip the declaration. Binding here rather than at the call site keeps a
 * prototype method's `this` correct and leaves a class field's own arrow
 * function unchanged.
 */
export function lifecycleCallable(
  instance: unknown,
  name: LifecycleHookName<LifecycleHookContract>,
): LifecycleCall | undefined {
  if (typeof instance !== "object" || instance === null) {
    return undefined;
  }

  const candidate = (instance as Record<string, unknown>)[name];
  return typeof candidate === "function" ? (candidate as LifecycleCall).bind(instance) : undefined;
}
