import { AponiaError, getTokenName, type ModuleDefinition, type Token } from "@aponiajs/common";
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

    const imports = module.imports.map(rewrite);
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
