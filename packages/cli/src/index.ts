export { parseArguments } from "./commands/arguments.ts";
export { schematicNames } from "./commands/command.constants.ts";
export type {
  CliCommand,
  GenerateCommandOptions,
  GenerateSchematic,
  ResourceTransport,
} from "./interfaces/command.interface.ts";
export { runCli } from "./commands/run-cli.ts";
export { buildPlugin, buildPluginName } from "./bundler/aponia-build-plugin.ts";
export type { BuildPluginOptions } from "./interfaces/aponia-build-plugin.interface.ts";
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
} from "./interfaces/descriptor-emitter.interface.ts";
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
} from "./interfaces/module-descriptors.interface.ts";
export { generateInvokers } from "./generation/invoker-generator.ts";
export { checkLibrary } from "./library/check-library.ts";
export type {
  LibraryCheckOptions,
  LibraryCheckResult,
} from "./interfaces/check-library.interface.ts";
export { analyzeBuildProject, invokerModuleFileName } from "./generation/build-project-analysis.ts";
export type {
  AnalyzeBuildProjectOptions,
  BuildProjectAnalysis,
} from "./interfaces/build-project-analysis.interface.ts";
export type {
  GenerateInvokersOptions,
  GenerateInvokersResult,
} from "./interfaces/invoker-generator.interface.ts";
export type {
  ControllerImportSpecifiers,
  ControllerInvokerProvenance,
  DeclinedControllerHandler,
  EmittedControllerInvokers,
  EmittableControllerHandler,
  EmittableRouteParameter,
  EmittableRouteParameterKind,
} from "./interfaces/controller-invokers.interface.ts";
export type {
  AnalyzedController,
  AnalyzedRequestMethod,
  AnalyzedRoute,
  AnalyzedRouteParameter,
  AnalyzedRouteParameterKind,
  AnalyzedRouteSchema,
  AnalyzedRouteSchemaSlot,
  AnalyzedRouteSchemaSlotName,
} from "./interfaces/controller-routes.interface.ts";
export { collectSourceImports, parseSourceExpression } from "./generation/source-imports.ts";
export type {
  SourceImport,
  SourceImportForm,
  SourceImportKind,
  SourceImports,
  SourceImportsReading,
} from "./interfaces/source-imports.interface.ts";
export { generateProject } from "./generation/project-generator.ts";
export type {
  GenerateProjectOptions,
  GenerateProjectResult,
} from "./interfaces/project-generator.interface.ts";
export { generateSchematic } from "./generation/schematic-generator.ts";
export type {
  GenerateSchematicOptions,
  GenerateSchematicResult,
  SchematicChange,
} from "./interfaces/schematic.interface.ts";
