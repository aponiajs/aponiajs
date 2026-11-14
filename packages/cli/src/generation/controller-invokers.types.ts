import type { AnalyzedController, AnalyzedRouteParameter } from "./controller-routes.types.ts";

/**
 * Where a controller class is imported from in the generated module, keyed by
 * the class name the analysis reported.
 */
export type ControllerImportSpecifiers = Readonly<Record<string, string>>;

/**
 * One handler the emitter declined to generate for, with the reason.
 *
 * A declined handler is not an error: the runtime compiles it exactly as it
 * does today, so an application can mix generated and compiled routes.
 */
export interface DeclinedControllerHandler {
  readonly controller: string;
  readonly method: string;
  readonly reason: string;
}

/** The result of emitting an invoker module for a set of controllers. */
export interface EmittedControllerInvokers {
  /** The module source, or `undefined` when nothing could be generated. */
  readonly source: string | undefined;
  /** Handlers the emitter left to the runtime, in declaration order. */
  readonly declined: readonly DeclinedControllerHandler[];
}

/**
 * What produced a generated invoker module.
 *
 * The platform refuses an artifact from another framework release and compiles
 * the routes itself, so the generated file has to say which release and which
 * Elysia it was built against. `elysia` is `null` when no installed Elysia could
 * be resolved at generation time, which the platform reports rather than
 * treats as a match.
 */
export interface ControllerInvokerProvenance {
  readonly framework: string;
  readonly elysia: string | null;
}

/**
 * A parameter binding the emitter can reproduce without the platform's types.
 *
 * `context` is excluded on purpose: a handler that takes the whole context
 * passes the invoker's own parameter through, so the invoker's parameter would
 * have to be the application's context type, which this package cannot name.
 */
export type EmittableRouteParameterKind = Exclude<AnalyzedRouteParameter["kind"], "context">;

/** One route parameter the emitter will generate a read for. */
export type EmittableRouteParameter = AnalyzedRouteParameter & {
  readonly kind: EmittableRouteParameterKind;
};

/** One handler the emitter will generate an invoker for. */
export interface EmittableControllerHandler {
  readonly controller: AnalyzedController;
  readonly methodName: string;
  readonly parameters: readonly EmittableRouteParameter[];
}
