import { AponiaError, type Provider, type Token } from "@aponiajs/common";

/**
 * Why a value cannot serve as a provider, or `undefined` when it can.
 *
 * A provider arrives from a module declaration a JavaScript caller wrote — which
 * has no type checker — or from a descriptor artifact a build wrote, which the
 * platform guards at the module level and not inside this array. Every field this
 * framework reads off a provider is therefore required here, so that an entry of
 * the wrong shape is stated as a fact about that entry instead of surfacing as a
 * `TypeError` from inside the compiler or the container.
 *
 * The shape it deliberately does not accept is the one the framework this one
 * mirrors does: NestJS writes a provider as `{ provide, useValue }`, so a
 * developer arriving from it writes that first, and `getProviderDependencies` below
 * would read `kind` off it, find no case, and hand `undefined` to a caller that
 * iterates the answer.
 *
 * @internal
 */
export function providerShapeProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return `a provider is an object and this is ${value === null ? "null" : typeof value}`;
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;

  switch (kind) {
    case "value":
      return "provide" in candidate && "useValue" in candidate
        ? undefined
        : 'a "value" provider needs both a "provide" token and a "useValue"';
    case "alias":
      return "provide" in candidate && "useExisting" in candidate
        ? undefined
        : 'an "alias" provider needs both a "provide" token and a "useExisting" token';
    case "class":
      return "provide" in candidate &&
        typeof candidate.useClass === "function" &&
        Array.isArray(candidate.inject)
        ? undefined
        : 'a "class" provider needs a "provide" token, a "useClass" constructor, and an "inject" array';
    case "factory":
      return "provide" in candidate &&
        typeof candidate.useFactory === "function" &&
        Array.isArray(candidate.inject)
        ? undefined
        : 'a "factory" provider needs a "provide" token, a "useFactory" function, and an "inject" array';
    default:
      return `its kind is "${
        typeof kind === "string" ? kind : typeof kind
      }", and a provider kind is "value", "class", "factory", or "alias"`;
  }
}

/**
 * The single rule for what a provider depends on. The container resolves
 * through it, and platform adapters that need to describe a graph without
 * building one read it rather than restating the switch.
 *
 * The default is the half of the rule the compiler cannot supply on its own: the
 * graph walk refuses a provider of an unknown kind before it reaches here, but
 * this function is exported for the adapters that read a graph, and a switch that
 * answered `undefined` to a caller iterating it is how a wrong-shaped provider
 * used to become an unnamed `TypeError` two frames away from the entry at fault.
 *
 * @internal
 */
export function getProviderDependencies(provider: Provider): readonly Token<unknown>[] {
  switch (provider.kind) {
    case "value":
      return [];
    case "alias":
      return [provider.useExisting];
    case "class":
    case "factory":
      return provider.inject;
    default:
      throw new AponiaError(
        "INVALID_PROVIDER",
        `A provider of kind "${String((provider as { readonly kind?: unknown }).kind)}" is not one this release can read.`,
        { kind: String((provider as { readonly kind?: unknown }).kind) },
      );
  }
}
