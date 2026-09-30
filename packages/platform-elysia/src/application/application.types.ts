import type { ClassToken, LoggerService, LogLevel } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";
import type { ElysiaConfig, EventScope } from "elysia/types";
import type { AponiaModuleDescriptorArtifact } from "../modules/module-descriptor-artifact.types.ts";
import type { ElysiaPlugin } from "../plugins/plugin.types.ts";
import type { AponiaInvokerArtifact } from "../routing/invoker-artifact.types.ts";

export type ElysiaConfigurator<TNativeApplication extends AnyElysia> = (
  application: Elysia,
) => TNativeApplication;

export type RouteCompilationOptions = Readonly<
  Pick<ElysiaConfig<undefined, EventScope>, "precompile">
>;

export interface AponiaApplicationOptions {
  readonly logger?: false | LoggerService | readonly LogLevel[];
  /**
   * Controls Elysia's route composition. This is distinct from build-time
   * Aponia source generation and JavaScriptCore's machine-code JIT.
   *
   * `precompile: true` compiles every route handler when the application
   * listens rather than on the first request that reaches it.
   *
   * Elysia 1.4 also offered `aot`, whose `false` selected a dispatcher that
   * never read a route's own `error` array — where every declared exception
   * filter and the default Problem Details mapping live. Elysia 2 has no such
   * mode: a route-local `error` handler runs under every configuration this
   * release can select, so the option and the warning that described it are
   * gone rather than accepted and ignored.
   */
  readonly elysia?: RouteCompilationOptions;
  /**
   * A build-time generated invoker artifact, as `aponia build` writes it. Its
   * invokers are keyed by controller class token, and each factory receives the
   * container's controller instance and returns that controller's invokers
   * keyed by handler property key.
   *
   * A controller without an entry, and a handler without a property key in its
   * controller's map, are compiled from decorator metadata exactly as they are
   * when this option is omitted. Keys survive minification because they are
   * class tokens rather than names.
   *
   * An artifact built by another framework release is refused whole and the
   * application boots on compiled binding; see {@link AponiaInvokerArtifact}.
   */
  readonly invokers?: AponiaInvokerArtifact;
  /**
   * A build-time generated module descriptor artifact, as `aponia build` writes
   * it. Its record holds one declared module per module class name, and the root
   * module passed to the factory is substituted by the declaration matching its
   * name.
   *
   * An artifact this release cannot use — one built by another framework
   * release, one whose root name it does not hold, or one whose entries are not
   * module descriptors — is refused whole and the root module is lowered from
   * its decorators exactly as it is when this option is omitted. Refusing costs
   * the lowering the artifact exists to remove and nothing more, so supplying it
   * can never make a bootable application fail.
   *
   * The startup log reports which of the two graphs served the application,
   * because the answer decides what a route actually runs.
   */
  readonly descriptors?: AponiaModuleDescriptorArtifact;
  /**
   * Native Elysia plugins the application mounts on its own root instance,
   * beside the ones its modules register through module imports.
   *
   * An entry mounts where a module-registered plugin does — the same `use()` on
   * the same root application, before any controller mounts. It mounts before
   * the plugins the module graph contributes, and both the request and the
   * after-response phase run in mount order, so a hook declared here runs
   * before one a module's plugin declares.
   *
   * What it is not is part of the module graph: no module declares it, so
   * nothing about it reaches `compileRootModule`, `inspectAponiaApplication`,
   * or the artifacts `aponia build` writes. That is the trade, and it is why a
   * plugin whose source a module can name belongs in that module's `imports`
   * (`PluginModule.register`, `definePlugin`) instead: an import is
   * what keeps a plugin in the declared graph.
   *
   * This option is for the plugins a module cannot declare. `aponia build`
   * lowers a module only when every `imports` entry names its declaration with
   * a single identifier, so an entry that is a call expression — as
   * `DevtoolsModule.register(...)` is — declines the module that wrote it. A
   * declined root leaves the committed descriptor artifact either holding the
   * declaration it already had, which serves a graph the registration is not
   * in, or holding none for that root, which bootstrap refuses. A plugin
   * mounted here leaves `imports` alone, so the module that would have been
   * declined stays declarable.
   *
   * An entry that is `undefined` mounts nothing. That is the shape a plugin
   * factory states a decision with: a registration the application chose not to
   * enable returns `undefined` rather than an inert plugin, so a boot cannot
   * mistake it for an enabled one. Every other entry reaches Elysia unchanged.
   */
  readonly plugins?: readonly (ElysiaPlugin | undefined)[];
  /**
   * Guards every route the platform mounts runs, before the ones a controller
   * or a handler declares.
   *
   * A global guard reaches every route the platform mounts, whatever module
   * mounted it, so it is resolved once, through the root module: the class must
   * be a provider the root module can reach, and one it cannot reach fails
   * `AponiaFactory.create` with the `MISSING_PROVIDER` a missing dependency
   * raises rather than leaving a route unguarded.
   *
   * The exception is a mount the platform does not compile: a controller
   * registered through its own `registerRoutes` callback, and a definition
   * mounted through its own `buildPlugin`, own their routes' hooks, so neither
   * runs a global guard or one the route declares.
   *
   * There is deliberately no `useGlobalGuards()` method: routes mount during
   * `AponiaFactory.create`, so a method called on the returned application could
   * not affect them.
   */
  readonly guards?: readonly ClassToken<unknown>[];
  /**
   * Interceptors every route the platform mounts runs, declared and resolved
   * the way `guards` are, the same mounts excluded.
   */
  readonly interceptors?: readonly ClassToken<unknown>[];
  /**
   * Filters every route the platform mounts consults, declared and resolved the
   * way `guards` are, the same mounts excluded.
   */
  readonly filters?: readonly ClassToken<unknown>[];
}

export interface ConfiguredAponiaApplicationOptions<
  TNativeApplication extends AnyElysia,
> extends AponiaApplicationOptions {
  readonly configureNative: ElysiaConfigurator<TNativeApplication>;
}
