export { parseArguments } from "./commands/arguments.ts";
export { schematicNames } from "./commands/command.constants.ts";
export type {
  CliCommand,
  GenerateCommandOptions,
  GenerateSchematic,
  ResourceTransport,
} from "./commands/command.types.ts";
export { runCli } from "./commands/run-cli.ts";
export { buildPlugin, buildPluginName } from "./bundler/aponia-build-plugin.ts";
export type { BuildPluginOptions } from "./bundler/aponia-build-plugin.types.ts";
export { analyzeControllerRoutes } from "./generation/controller-routes.ts";
export { emitControllerInvokers } from "./generation/controller-invokers.ts";
export {
  descriptorModuleFileName,
  emitModuleDescriptors,
} from "./generation/descriptor-emitter.ts";
export type {
  DeclinedDescriptor,
  DeclinedModuleDescriptor,
  DeclinedRouteDescriptor,
  DescriptorSourceFile,
  EmittedModuleDescriptors,
  ModuleDescriptorProvenance,
} from "./generation/descriptor-emitter.types.ts";
export { analyzeModuleDescriptors } from "./generation/module-descriptors.ts";
export type {
  AnalyzedConstructorDependency,
  AnalyzedControllerDeclaration,
  AnalyzedGateway,
  AnalyzedInjectedDependency,
  AnalyzedInjectable,
  AnalyzedModule,
  AnalyzedModuleDescriptors,
  AnalyzedModuleEntry,
  AnalyzedToken,
  AnalyzedTokenKind,
  AnalyzedTypedDependency,
  AnalyzedUnreadableDependency,
} from "./generation/module-descriptors.types.ts";
export { generateInvokers } from "./generation/invoker-generator.ts";
export { analyzeBuildProject, invokerModuleFileName } from "./generation/build-project-analysis.ts";
export type {
  AnalyzeBuildProjectOptions,
  BuildProjectAnalysis,
} from "./generation/build-project-analysis.types.ts";
export type {
  GenerateInvokersOptions,
  GenerateInvokersResult,
} from "./generation/invoker-generator.types.ts";
export type {
  ControllerImportSpecifiers,
  ControllerInvokerProvenance,
  DeclinedControllerHandler,
  EmittedControllerInvokers,
  EmittableControllerHandler,
  EmittableRouteParameter,
  EmittableRouteParameterKind,
} from "./generation/controller-invokers.types.ts";
export type {
  AnalyzedController,
  AnalyzedRequestMethod,
  AnalyzedRoute,
  AnalyzedRouteParameter,
  AnalyzedRouteParameterKind,
  AnalyzedRouteSchema,
  AnalyzedRouteSchemaSlot,
  AnalyzedRouteSchemaSlotName,
} from "./generation/controller-routes.types.ts";
export { collectSourceImports, parseSourceExpression } from "./generation/source-imports.ts";
export type {
  SourceImport,
  SourceImportForm,
  SourceImportKind,
  SourceImports,
  SourceImportsReading,
} from "./generation/source-imports.types.ts";
export { generateProject } from "./generation/project-generator.ts";
export type {
  GenerateProjectOptions,
  GenerateProjectResult,
} from "./generation/project-generator.types.ts";
export { generateSchematic } from "./generation/schematic-generator.ts";
export type {
  GenerateSchematicOptions,
  GenerateSchematicResult,
  SchematicChange,
} from "./generation/schematic.types.ts";
