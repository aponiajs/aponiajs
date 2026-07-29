import type { ControllerDefinition, Provider, Token } from "@aponiajs/common";

export function controllerDependencies(
  controller: ControllerDefinition,
): readonly Token<unknown>[] {
  return controller.inject;
}

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
