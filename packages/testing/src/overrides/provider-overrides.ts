import {
  AponiaError,
  forwardRef,
  getTokenName,
  isForwardRef,
  type ControllerDefinition,
  type ModuleDefinition,
  type Provider,
  type Token,
} from "@aponiajs/common";
import type { ProviderOverrides } from "./provider-overrides.types.ts";

/**
 * Replaces the provider each override names, across a compiled module graph.
 *
 * The rewrite is a substitution over the descriptors `compileRootModule` already
 * produced, so it needs no cooperation from the platform and cannot disturb the
 * bootstrap: the returned graph is the same shape, with the same modules,
 * controllers, imports, and exports, and only the named providers differ. A
 * module is rewritten once however many paths reach it — a diamond imports one
 * module object in two places, and producing two copies of it would make the
 * graph compiler see two modules sharing an identity and refuse the boot with
 * `DUPLICATE_MODULE`.
 *
 * A token no reachable module provides raises `MISSING_PROVIDER` rather than
 * returning a graph that changed nothing: a test that believes it stubbed a
 * dependency still boots, still passes, and asserts against the real one, which
 * is a worse outcome than a refused build.
 *
 * @param root - The compiled root to rewrite.
 * @param overrides - The replacement provider per overridden token.
 * @returns The rewritten root, frozen like the graph it replaces.
 * @throws An `AponiaError` with `MISSING_PROVIDER` for an unprovided token.
 */
export function applyProviderOverrides(
  root: ModuleDefinition,
  overrides: ProviderOverrides,
): ModuleDefinition {
  const replacedTokens = new Set<Token<unknown>>();
  const rewrittenModules = new Map<ModuleDefinition, ModuleDefinition>();

  const rewrite = (module: ModuleDefinition): ModuleDefinition => {
    const cached = rewrittenModules.get(module);
    if (cached) {
      return cached;
    }

    const imports = module.imports.map((rawImport) => {
      if (isForwardRef(rawImport)) {
        return forwardRef(() => rewrite(rawImport.forwardRef()));
      }
      return rewrite(rawImport);
    });
    const providers = module.providers.map((provider) => {
      const replacement = overrides.get(provider.provide);
      if (!replacement) {
        return provider;
      }
      replacedTokens.add(provider.provide);
      return replacement;
    });

    const rewritten: ModuleDefinition = Object.freeze({
      ...module,
      imports: Object.freeze(imports),
      providers: Object.freeze(providers),
      controllers: Object.freeze(
        module.controllers.map((controller) => rewriteControllerPipes(controller, overrides)),
      ),
    });
    rewrittenModules.set(module, rewritten);
    return rewritten;
  };

  const rewrittenRoot = rewrite(root);
  for (const token of overrides.keys()) {
    if (!replacedTokens.has(token)) {
      throw new AponiaError(
        "MISSING_PROVIDER",
        `No module in the compiled graph provides token "${getTokenName(token)}", so overriding it would change nothing.`,
        { token: getTokenName(token) },
      );
    }
  }

  return rewrittenRoot;
}

/** The part of a compiled route plan a pipe override rewrites. */
interface CompiledRouteLike {
  readonly pipes?: readonly unknown[];
  readonly parameters?: readonly { readonly pipes?: readonly unknown[] }[];
  readonly [key: string]: unknown;
}

interface ControllerWithPlan extends ControllerDefinition {
  readonly compiledRoutes?: readonly CompiledRouteLike[];
}

/**
 * Rewrites the pipe classes a controller's compiled route plan names.
 *
 * A guard, interceptor, or filter is resolved from the container while its
 * controller mounts, so the provider rewrite above is the whole substitution.
 * A route-level pipe class is constructed directly by `resolvePipe` at mount
 * instead — the platform's own fast path — so the plan has to state the
 * substitute before it mounts. A substitute class is constructed with no
 * arguments, the same rule `resolvePipe` states for a pipe class.
 */
function rewriteControllerPipes(
  controller: ControllerDefinition,
  overrides: ProviderOverrides,
): ControllerDefinition {
  const compiledRoutes = (controller as ControllerWithPlan).compiledRoutes;
  if (compiledRoutes === undefined) {
    return controller;
  }

  let changed = false;
  const routes = compiledRoutes.map((route) => {
    const pipes =
      route.pipes === undefined
        ? undefined
        : substitutePipes(route.pipes, overrides, () => {
            changed = true;
          });
    const parameters = route.parameters?.map((parameter) => {
      if (parameter.pipes === undefined) {
        return parameter;
      }
      const parameterPipes = substitutePipes(parameter.pipes, overrides, () => {
        changed = true;
      });
      return parameterPipes === parameter.pipes
        ? parameter
        : Object.freeze({ ...parameter, pipes: Object.freeze(parameterPipes) });
    });

    if (pipes === route.pipes && parameters === route.parameters) {
      return route;
    }
    return Object.freeze({
      ...route,
      ...(pipes === undefined ? {} : { pipes: Object.freeze(pipes) }),
      ...(parameters === undefined ? {} : { parameters: Object.freeze(parameters) }),
    });
  });

  return changed
    ? Object.freeze({ ...controller, compiledRoutes: Object.freeze(routes) })
    : controller;
}

function substitutePipes(
  pipes: readonly unknown[],
  overrides: ProviderOverrides,
  onChanged: () => void,
): readonly unknown[] {
  let substituted = false;
  const entries = pipes.map((entry) => {
    if (typeof entry !== "function") {
      return entry;
    }
    const replacement = overrides.get(entry as Token<unknown>);
    if (replacement === undefined) {
      return entry;
    }
    substituted = true;
    onChanged();
    return inlinePipe(replacement, entry as Token<unknown>);
  });

  return substituted ? entries : pipes;
}

function inlinePipe(provider: Provider, token: Token<unknown>): unknown {
  switch (provider.kind) {
    case "value":
      return provider.useValue;
    case "class":
      return provider.useClass;
    default:
      throw new AponiaError(
        "INVALID_PIPE",
        `A route-level pipe override for "${getTokenName(token)}" must supply a class or an instance; a ${provider.kind} provider is resolved by the container, and a route-level pipe class is not.`,
        { token: getTokenName(token), providerKind: provider.kind },
      );
  }
}
