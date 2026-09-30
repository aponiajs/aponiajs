import type { ClassToken, LoggerService, LogLevel } from "@aponiajs/common";
import type { AnyElysia, Elysia } from "elysia";
import type { ElysiaConfig, EventScope } from "elysia/types";
import type { AponiaModuleDescriptorArtifact } from "../modules/module-descriptor-artifact.types.ts";
import type { ElysiaPlugin } from "../plugins/plugin.types.ts";
import type { AponiaInvokerArtifact } from "../routing/invoker-artifact.types.ts";
import type { AponiaHealthOptions } from "./application-health.types.ts";

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
   * Readiness and liveness probes, mounted on this application's own route
   * table. `true` mounts the conventional pair; an object moves their paths;
   * omitting the option mounts nothing.
   *
   * Liveness answers `200 application/health+json` for as long as the process
   * answers at all. Readiness answers the same until this application begins to
   * stop and `503` from then on, which is what lets an orchestrator stop routing
   * to an application before its connections end rather than during.
   *
   * Both are ordinary routes with no hook, so no guard, interceptor, or filter
   * runs for one: an orchestrator polling for readiness may not be able to
   * present credentials, and a probe behind an authentication guard reports
   * every replica unhealthy at once.
   *
   * The probes mount outside the module graph, so nothing about them reaches
   * `compileRootModule`, `inspectAponiaApplication`, or a generated artifact.
   * A path a controller already claims fails the boot with `DUPLICATE_ROUTE`
   * instead, because Elysia would otherwise answer the repeated path from
   * whichever registration it resolves.
   */
  readonly health?: boolean | AponiaHealthOptions;
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

/**
 * What `AponiaApplication.listen` may be asked for beyond the port.
 *
 * It is an option on `listen` rather than a factory option, because it describes
 * what happens once the application serves traffic: an application that is only
 * ever driven through `application.handle` never binds a listener, and one that
 * binds one says so at the call that binds it. Installing a handler at boot
 * would also take the process's signals away from every application that only
 * built an application object, which is the compatibility break an opt-in
 * exists to avoid.
 *
 * The same object is shaped the way `AponiaApplicationOptions` is — readonly,
 * optional, and stated where the consequence is — so a reader of one contract
 * reads the other without a second convention.
 */
export interface AponiaListenOptions {
  /**
   * Runs `close()` when the process receives `SIGTERM` or `SIGINT`, instead of
   * letting the runtime's default action end it abruptly. Defaults to `false`,
   * which installs nothing at all.
   *
   * This is opt-in because taking a process's signals is a decision about the
   * host process rather than about this application: a library that answers
   * `SIGTERM` for whoever imported it takes that decision away from a program
   * that may have its own handler, and it breaks every lane that listens without
   * wanting its process to be owned.
   *
   * What a signal runs is exactly the teardown `close()` already documents —
   * `beforeApplicationShutdown`, then the server stop, then `onModuleDestroy` and
   * `onApplicationShutdown` — so the readiness probe has already flipped to
   * `fail` by the time the first hook runs. A second signal is not handled at
   * all: the listeners are removed the moment the first one arrives, so a repeat
   * reaches the default action and ends the process at once, which is the escape
   * hatch a teardown that never returns would otherwise take away. The exit
   * status is the signal's own, because the signal is re-raised after the
   * listeners are gone rather than replaced by an exit call.
   *
   * A signal that arrives before `listen` has finished starting the application
   * is not caught: only an application that stopped starting cleanly owns them.
   */
  readonly shutdownSignals?: boolean;
}
