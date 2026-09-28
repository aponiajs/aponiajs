import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "@aponiajs/common";
import type { AponiaContainer } from "@aponiajs/core";
import { isElysiaController } from "../controllers/controller-definition.ts";

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
 * The member names the five contracts contribute, gathered member by member.
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

/**
 * Every hook the graph declares for one moment, in the order a boot reaches
 * them: modules in graph order — post-order, so a module that imports another
 * comes first — and within a module its providers in declaration order, then
 * its controllers.
 *
 * **Once per instance, not once per entry.** One object can be reached through
 * more than one entry: an alias resolves to its target, and a provider a module
 * exports is the same instance its importers resolve. Walking entries alone
 * would call one object's hook once per entry, which is a pool opened twice and
 * a timer started twice for one object — the hooks are a fact about the
 * instance, and this is what makes them one.
 */
export function collectLifecycleCalls(
  container: AponiaContainer,
  name: LifecycleHookName<LifecycleHookContract>,
): LifecycleCall[] {
  const calls: LifecycleCall[] = [];
  const collected = new Set<unknown>();

  const collect = (instance: unknown): void => {
    if (collected.has(instance)) {
      return;
    }
    collected.add(instance);

    const call = lifecycleCallable(instance, name);
    if (call) {
      calls.push(call);
    }
  };

  for (const module of container.graph.modules) {
    for (const provider of module.providers) {
      collect(container.resolveModuleProvider(module, provider.provide));
    }
    for (const controller of module.controllers) {
      if (isElysiaController(controller)) {
        collect(container.instantiateController(module, controller));
      }
    }
  }

  return calls;
}
