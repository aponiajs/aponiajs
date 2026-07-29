import type { AnyElysia, Elysia, MergeElysiaInstances } from "elysia";

type FunctionResult<TFunction> = TFunction extends (
  ...arguments_: infer _TArguments
) => infer TResult
  ? TResult
  : never;

type ControllerPlugin<TController> = TController extends {
  readonly buildPlugin: infer TBuildPlugin;
}
  ? FunctionResult<TBuildPlugin> extends infer TPlugin extends AnyElysia
    ? TPlugin
    : never
  : never;

type ControllerPlugins<TControllers> = TControllers extends readonly [
  infer TController,
  ...infer TRest,
]
  ? ControllerPlugin<TController> extends infer TPlugin
    ? [TPlugin] extends [never]
      ? ControllerPlugins<TRest>
      : TPlugin extends AnyElysia
        ? [TPlugin, ...ControllerPlugins<TRest>]
        : ControllerPlugins<TRest>
    : ControllerPlugins<TRest>
  : [];

type ImportedNativePlugins<TImports> = TImports extends readonly [infer TImport, ...infer TRest]
  ? [...ModuleNativePlugins<TImport>, ...ImportedNativePlugins<TRest>]
  : [];

type ModuleNativePlugins<TModule> = TModule extends {
  readonly imports: infer TImports;
}
  ? [
      ...ImportedNativePlugins<TImports>,
      ...(TModule extends { readonly plugin: infer TPlugin extends AnyElysia } ? [TPlugin] : []),
    ]
  : TModule extends { readonly plugin: infer TPlugin extends AnyElysia }
    ? [TPlugin]
    : [];

type ImportedControllerPlugins<TImports> = TImports extends readonly [infer TImport, ...infer TRest]
  ? [...ModuleControllerPlugins<TImport>, ...ImportedControllerPlugins<TRest>]
  : [];

type ModuleControllerPlugins<TModule> = TModule extends {
  readonly imports: infer TImports;
  readonly controllers: infer TControllers;
}
  ? [...ImportedControllerPlugins<TImports>, ...ControllerPlugins<TControllers>]
  : [];

type ModuleApplicationPlugins<TModule> = [
  ...ModuleNativePlugins<TModule>,
  ...ModuleControllerPlugins<TModule>,
];

/**
 * The native Elysia application produced from a statically declared Aponia
 * module.
 *
 * Controller factories and native plugin imports retain their exact Elysia
 * route types. Decorated classes and runtime-discovered modules intentionally
 * contribute no inferred routes because TypeScript cannot observe their
 * runtime metadata.
 */
export type AponiaNativeApplication<
  TRootModule,
  TConfiguredApplication extends AnyElysia = Elysia,
> = MergeElysiaInstances<[TConfiguredApplication, ...ModuleApplicationPlugins<TRootModule>]>;
