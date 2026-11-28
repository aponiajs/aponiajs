type AponiaContainer = {
  readonly graph: {
    readonly root: import("../interfaces/module.interface.ts").ModuleDefinition;
    readonly modules: readonly import("../interfaces/module.interface.ts").ModuleDefinition[];
  };
  get<T>(token: import("../interfaces/token.interface.ts").Token<T>): T;
  resolveModuleProvider<T>(
    moduleDefinition: import("../interfaces/module.interface.ts").ModuleDefinition,
    token: import("../interfaces/token.interface.ts").Token<T>,
  ): T;
};
import { createToken } from "../tokens/token.ts";
import { provideFactory, provideValue } from "../providers/provider.ts";
import { type ModuleDefinition } from "../interfaces/module.interface.ts";
import { type Provider } from "../interfaces/provider.interface.ts";
import { type Token, type TokenMap } from "../interfaces/token.interface.ts";
import type { RequestLifecycleHook } from "../interfaces/request-hooks.interface.ts";

export type { RequestLifecycleHook } from "../interfaces/request-hooks.interface.ts";

/**
 * The hooks one module contributes.
 * @internal
 */
export const REQUEST_LIFECYCLE_HOOKS = createToken<readonly RequestLifecycleHook[]>(
  "aponia.request.lifecycle-hooks",
);

/**
 * Registers one request lifecycle hook.
 *
 * A module that contributes two hooks registers them together with
 * {@link provideRequestLifecycleHooks}: a module's providers are unique by
 * token, so two separate values would be refused as a duplicate.
 *
 * @param hook - The hook's name and the phases it implements.
 * @returns A frozen value provider the module's `providers` accepts.
 * @throws A `TypeError` when the hook states no name or no phase.
 */
export function provideRequestLifecycleHook(hook: RequestLifecycleHook): Provider {
  return provideRequestLifecycleHooks(hook);
}

/**
 * Registers a module's request lifecycle hooks in declaration order.
 *
 * @param hooks - The hooks this module contributes.
 * @returns A frozen value provider the module's `providers` accepts.
 * @throws A `TypeError` when a hook states no name or no phase.
 */
export function provideRequestLifecycleHooks(...hooks: readonly RequestLifecycleHook[]): Provider {
  const checked = hooks.map((hook) => checkHook(hook));
  return provideValue(REQUEST_LIFECYCLE_HOOKS, Object.freeze(checked));
}

/**
 * Registers a module's request lifecycle hooks from a factory over injected
 * values.
 *
 * The asynchronous form a registration whose hook depends on a validated
 * configuration uses; the factory runs once in the boot's provider pass.
 *
 * @param dependencies - The tokens the factory receives.
 * @param factory - Builds one hook, or several, from the resolved values.
 * @returns A factory provider the module's `providers` accepts.
 */
export function provideRequestLifecycleHooksAsync<
  const TDependencies extends readonly Token<unknown>[],
>(
  dependencies: TDependencies,
  factory: (
    ...values: TokenMap<TDependencies>
  ) => RequestLifecycleHook | readonly RequestLifecycleHook[],
): Provider {
  return provideFactory(
    REQUEST_LIFECYCLE_HOOKS,
    dependencies,
    (...values: TokenMap<TDependencies>) => {
      const built = factory(...values);
      const list = Array.isArray(built) ? built : [built as RequestLifecycleHook];
      return Object.freeze(list.map((hook) => checkHook(hook)));
    },
  );
}

/**
 * Compiles the hooks the whole graph contributes, once at boot.
 *
 * @param container - The container the boot built.
 * @returns The hooks in module order, then declaration order.
 */
export function resolveRequestLifecycleHooks(
  container: AponiaContainer,
): readonly RequestLifecycleHook[] {
  const resolved: RequestLifecycleHook[] = [];
  for (const module of container.graph.modules) {
    resolved.push(...readHooks(container, module));
  }
  return Object.freeze(resolved);
}

/**
 * Calls every hook's `onResponse` phase.
 *
 * An observer that throws may not change the answer, so a failure is dropped.
 *
 * @param hooks - The resolved hooks.
 * @param request - The request the response answers.
 * @param response - The final response.
 */
export async function notifyRequestResponse(
  hooks: readonly RequestLifecycleHook[],
  request: Request,
  response: Response,
): Promise<void> {
  for (let i = 0; i < hooks.length; i += 1) {
    const onResponse = hooks[i]!.onResponse;
    if (onResponse === undefined) {
      continue;
    }
    try {
      const result = onResponse(request, response);
      if (result !== undefined) {
        await result;
      }
    } catch {
      // An observer cannot change the answer it observes.
    }
  }
}

/**
 * Calls every hook's `onError` phase.
 *
 * @param hooks - The resolved hooks.
 * @param request - The request that failed.
 * @param error - The failure, before the route's filters and the default mapping.
 */
export async function notifyRequestError(
  hooks: readonly RequestLifecycleHook[],
  request: Request,
  error: unknown,
): Promise<void> {
  for (let i = 0; i < hooks.length; i += 1) {
    const onError = hooks[i]!.onError;
    if (onError === undefined) {
      continue;
    }
    try {
      const result = onError(request, error);
      if (result !== undefined) {
        await result;
      }
    } catch {
      // An observer cannot change the answer it observes.
    }
  }
}

/**
 * Runs each hook's `onRequest` phase until one answers.
 *
 * @param hooks - The resolved hooks.
 * @param request - The incoming request.
 * @returns The short-circuiting response, or `undefined`.
 */
export async function runRequestHooks(
  hooks: readonly RequestLifecycleHook[],
  request: Request,
): Promise<Response | undefined> {
  for (const hook of hooks) {
    if (hook.onRequest === undefined) {
      continue;
    }
    const response = await hook.onRequest(request);
    if (response !== undefined) {
      return response;
    }
  }
  return undefined;
}

function readHooks(
  container: AponiaContainer,
  module: ModuleDefinition,
): readonly RequestLifecycleHook[] {
  if (!module.providers.some((provider) => provider.provide === REQUEST_LIFECYCLE_HOOKS)) {
    return [];
  }
  return container.resolveModuleProvider(
    module,
    REQUEST_LIFECYCLE_HOOKS,
  ) as readonly RequestLifecycleHook[];
}

function checkHook(hook: RequestLifecycleHook): RequestLifecycleHook {
  if (typeof hook.name !== "string" || hook.name.trim().length === 0) {
    throw new TypeError("A request lifecycle hook needs a non-empty name.");
  }
  if (
    hook.onRequest === undefined &&
    hook.wrap === undefined &&
    hook.onResponse === undefined &&
    hook.onError === undefined
  ) {
    throw new TypeError(`The request lifecycle hook "${hook.name}" implements no phase.`);
  }
  return Object.freeze({
    name: hook.name,
    ...(hook.onRequest === undefined ? {} : { onRequest: hook.onRequest.bind(hook) }),
    ...(hook.wrap === undefined ? {} : { wrap: hook.wrap.bind(hook) }),
    ...(hook.onResponse === undefined ? {} : { onResponse: hook.onResponse.bind(hook) }),
    ...(hook.onError === undefined ? {} : { onError: hook.onError.bind(hook) }),
  });
}
