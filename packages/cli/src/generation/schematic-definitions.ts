import { pascalCase } from "change-case";
import type { GenerateSchematic, ResourceTransport } from "../commands/command.types.ts";
import type { ComponentNames } from "./component-names.types.ts";
import type { ModuleRegistrationKind } from "./module-registration.types.ts";
import type { ComponentSchematic, PendingFile, SchematicDefinition } from "./schematic.types.ts";

export const schematicDefinitions: Readonly<Record<ComponentSchematic, SchematicDefinition>> = {
  class: { defaultFlat: true, spec: true, suffix: "" },
  controller: {
    defaultFlat: false,
    spec: true,
    suffix: "controller",
    registration: "controllers",
  },
  decorator: { defaultFlat: true, spec: false, suffix: "decorator" },
  filter: { defaultFlat: true, spec: true, suffix: "filter" },
  gateway: { defaultFlat: true, spec: true, suffix: "gateway", registration: "providers" },
  guard: { defaultFlat: true, spec: true, suffix: "guard" },
  interface: { defaultFlat: true, spec: false, suffix: "interface" },
  interceptor: { defaultFlat: true, spec: true, suffix: "interceptor" },
  middleware: { defaultFlat: true, spec: true, suffix: "middleware" },
  module: { defaultFlat: false, spec: false, suffix: "module", registration: "imports" },
  pipe: { defaultFlat: true, spec: true, suffix: "pipe" },
  provider: { defaultFlat: true, spec: true, suffix: "", registration: "providers" },
  resolver: {
    defaultFlat: false,
    spec: true,
    suffix: "resolver",
    registration: "providers",
  },
  service: {
    defaultFlat: false,
    spec: true,
    suffix: "service",
    registration: "providers",
  },
};

export function classSuffix(schematic: ComponentSchematic): string {
  if (schematic === "class" || schematic === "provider" || schematic === "interface") {
    return "";
  }
  return pascalCase(schematic);
}

export function symbolFor(schematic: GenerateSchematic, names: ComponentNames): string {
  if (schematic === "resource") {
    return `${names.className}Module`;
  }
  return `${names.className}${classSuffix(schematic as ComponentSchematic)}`;
}

export function registrationFor(schematic: GenerateSchematic): ModuleRegistrationKind | undefined {
  if (schematic === "resource") {
    return "imports";
  }
  if (schematic === "app" || schematic === "library") {
    return undefined;
  }
  return schematicDefinitions[schematic].registration;
}

export function primaryFile(
  files: readonly PendingFile[],
  schematic: GenerateSchematic,
): PendingFile {
  const expectedSuffix =
    schematic === "resource"
      ? ".module.ts"
      : schematicDefinitions[schematic as ComponentSchematic].suffix
        ? `.${schematicDefinitions[schematic as ComponentSchematic].suffix}.ts`
        : ".ts";
  return files.find(
    (file) => file.path.endsWith(expectedSuffix) && !file.path.endsWith(".spec.ts"),
  )!;
}

export function resourceTransportStem(
  type: ResourceTransport,
): "controller" | "gateway" | "resolver" {
  if (type === "ws") {
    return "gateway";
  }
  if (type.startsWith("graphql")) {
    return "resolver";
  }
  return "controller";
}
