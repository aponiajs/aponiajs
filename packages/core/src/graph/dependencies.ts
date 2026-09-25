import type { Provider, Token } from "@aponiajs/common";

/**
 * The single rule for what a provider depends on. The container resolves
 * through it, and platform adapters that need to describe a graph without
 * building one read it rather than restating the switch.
 *
 * @internal
 */
export function providerDependencies(provider: Provider): readonly Token<unknown>[] {
  switch (provider.kind) {
    case "value":
      return [];
    case "alias":
      return [provider.useExisting];
    case "class":
    case "factory":
      return provider.inject;
  }
}
