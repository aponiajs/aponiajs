import {
  AponiaError,
  getEnhancerMetadata,
  getMcpPrimitiveMetadata,
  getPipesMetadata,
  type ClassToken,
  type ModuleDefinition,
} from "@aponiajs/common";
import { getApplicationContainer } from "@aponiajs/core";
import type { ResolvedMcpOptions } from "../interfaces/mcp-module.interface.ts";
import type { McpPlan, McpPrimitivePlan } from "../interfaces/mcp-plan.interface.ts";

type McpContainer = NonNullable<ReturnType<typeof getApplicationContainer>>;

const primitiveNamePattern = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Finds every decorated provider method one boot exposes.
 *
 * The plan is built while the platform adapter mounts, so a duplicate name or a
 * registration nothing can serve fails the boot rather than the first call.
 *
 * @internal
 */
export function buildMcpPlan(container: McpContainer, options: ResolvedMcpOptions): McpPlan {
  const tools = new Map<string, McpPrimitivePlan>();
  const resources = new Map<string, McpPrimitivePlan>();
  const resourceTemplates = new Map<string, McpPrimitivePlan>();
  const prompts = new Map<string, McpPrimitivePlan>();
  const included = includeKeys(options.include);

  for (const module of container.graph.modules) {
    if (!isIncluded(module, included)) {
      continue;
    }

    for (const provider of module.providers) {
      if (provider.kind !== "class") {
        continue;
      }
      // A provider with no MCP metadata is never exposed, so resolving it here
      // would instantiate every class in the graph — request-scoped ones fail
      // the boot for no registration.
      if (getMcpPrimitiveMetadata(provider.useClass.prototype).size === 0) {
        continue;
      }
      collectFor(
        container,
        module,
        provider.useClass,
        container.resolveModuleProvider(module, provider.provide) as object,
        options,
        { tools, resources, resourceTemplates, prompts },
      );
    }
  }

  return Object.freeze({
    tools: Object.freeze([...tools.values()]),
    resources: Object.freeze([...resources.values()]),
    resourceTemplates: Object.freeze([...resourceTemplates.values()]),
    prompts: Object.freeze([...prompts.values()]),
  });
}

function collectFor(
  container: McpContainer,
  module: ModuleDefinition,
  classToken: ClassToken<unknown>,
  instance: object,
  options: ResolvedMcpOptions,
  collections: {
    readonly tools: Map<string, McpPrimitivePlan>;
    readonly resources: Map<string, McpPrimitivePlan>;
    readonly resourceTemplates: Map<string, McpPrimitivePlan>;
    readonly prompts: Map<string, McpPrimitivePlan>;
  },
): void {
  const prototype = Object.getPrototypeOf(instance) as object;
  const primitives = getMcpPrimitiveMetadata(prototype);

  if (primitives.size === 0) {
    return;
  }

  const classEnhancers = getEnhancerMetadata(classToken);
  const classPipes = getPipesMetadata(classToken) ?? [];

  for (const [methodName, metadata] of primitives) {
    const handler = (instance as Record<string | symbol, unknown>)[methodName];
    if (typeof handler !== "function") {
      throw new AponiaError(
        "INVALID_MCP_PRIMITIVE",
        `${String(classToken.name)}.${String(methodName)} is decorated but is not a method.`,
        { provider: String(classToken.name), method: String(methodName) },
      );
    }

    const name =
      metadata.name ?? (metadata.kind === "resource" ? metadata.uri : String(methodName));
    if (name === undefined || !isValidPrimitiveName(metadata.kind, name)) {
      throw new AponiaError(
        "INVALID_MCP_PRIMITIVE",
        `${String(classToken.name)}.${String(methodName)} declares an invalid MCP name "${name ?? ""}".`,
        { provider: String(classToken.name), method: String(methodName), name },
      );
    }

    const methodEnhancers = getEnhancerMetadata(classToken, methodName);
    const methodPipes = getPipesMetadata(prototype, methodName) ?? [];
    const plan: McpPrimitivePlan = Object.freeze({
      kind: metadata.kind,
      name,
      metadata,
      instance,
      classToken,
      methodName,
      handler: handler as (...arguments_: unknown[]) => unknown,
      metatype: readMetatype(prototype, methodName),
      module,
      guards: Object.freeze([
        ...options.guards,
        ...classEnhancers.guards,
        ...methodEnhancers.guards,
      ]),
      interceptors: Object.freeze([
        ...options.interceptors,
        ...classEnhancers.interceptors,
        ...methodEnhancers.interceptors,
      ]),
      filters: Object.freeze([
        ...methodEnhancers.filters,
        ...classEnhancers.filters,
        ...options.filters,
      ]),
      pipes: Object.freeze([...options.pipes, ...classPipes, ...methodPipes]),
    });

    store(plan, collections);
  }

  // The container is read only through the plan's module at call time. Keeping
  // the reference here states the dependency rather than hiding it.
  void container;
}

function store(
  plan: McpPrimitivePlan,
  collections: {
    readonly tools: Map<string, McpPrimitivePlan>;
    readonly resources: Map<string, McpPrimitivePlan>;
    readonly resourceTemplates: Map<string, McpPrimitivePlan>;
    readonly prompts: Map<string, McpPrimitivePlan>;
  },
): void {
  switch (plan.kind) {
    case "tool":
      claim(collections.tools, plan, "tool");
      return;
    case "prompt":
      claim(collections.prompts, plan, "prompt");
      return;
    case "resource":
      claim(collections.resources, plan, "resource");
      return;
    case "resourceTemplate":
      claim(collections.resourceTemplates, plan, "resourceTemplate");
      return;
  }
}

function claim(
  registry: Map<string, McpPrimitivePlan>,
  plan: McpPrimitivePlan,
  kind: string,
): void {
  const key = kind === "resourceTemplate" ? (plan.metadata.uriTemplate ?? plan.name) : plan.name;
  const existing = registry.get(key);

  if (existing !== undefined) {
    throw new AponiaError(
      "DUPLICATE_MCP_PRIMITIVE",
      `Two MCP ${kind} registrations answer "${key}".`,
      {
        kind,
        name: key,
        first: String(existing.classToken.name),
        second: String(plan.classToken.name),
      },
    );
  }

  registry.set(key, plan);
}

function readMetatype(prototype: object, methodName: string | symbol): unknown {
  const parameters = Reflect.getMetadata("design:paramtypes", prototype, methodName) as
    | readonly unknown[]
    | undefined;

  return parameters?.[0];
}

function isValidPrimitiveName(kind: McpPrimitivePlan["kind"], name: string): boolean {
  if (kind === "resource" || kind === "resourceTemplate") {
    return name.length > 0;
  }

  return primitiveNamePattern.test(name);
}

function includeKeys(include: readonly unknown[]): ReadonlySet<unknown> {
  const keys = new Set<unknown>();

  for (const entry of include) {
    if (typeof entry === "function") {
      keys.add(entry);
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const candidate = entry as { readonly module?: unknown; readonly id?: unknown };
      if (typeof candidate.module === "function") {
        keys.add(candidate.module);
      }
      if (typeof candidate.id === "string") {
        keys.add(candidate.id);
      }
    }
  }

  return keys;
}

function isIncluded(module: ModuleDefinition, included: ReadonlySet<unknown>): boolean {
  return (
    included.size === 0 ||
    (module.moduleClass !== undefined && included.has(module.moduleClass)) ||
    included.has(module.id)
  );
}
