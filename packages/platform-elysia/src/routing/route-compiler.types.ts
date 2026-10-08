import type {
  EnhancerMetadata,
  PipeType,
  RequestMethod,
  RouteContext,
  RouteParameterKind,
  RouteParameterMetadata,
  RouteSchema,
} from "@aponiajs/common";
import type { InputSchema } from "elysia";

/**
 * A route handler compiled outside the platform, already bound to its
 * controller instance.
 *
 * Elysia reads handler source statically, so an invoker must name every context
 * field it uses directly instead of forwarding the context to a generic helper.
 *
 * The context parameter is `never` for the same reason the factory's instance
 * parameter is: an invoker is written against the application's own
 * annotations — `@Body() body: CreateUser` — rather than against `RouteContext`,
 * and a parameter that accepts nothing is the one type every such function is
 * assignable to. A generated artifact therefore declares its invokers without a
 * cast, and a hand-written one may still annotate the parameter `RouteContext`
 * to read the context it is given. Only the platform calls an invoker, and it
 * passes the real route context.
 */
export type RouteHandler = (context: never) => unknown;

/**
 * Builds the invokers of one controller once its instance exists, keyed by the
 * handler property key.
 *
 * The `instance` parameter is deliberately `never` so a factory declared for a
 * concrete controller type stays assignable without a cast.
 */
export type ControllerHandlerFactory = (
  instance: never,
) => ReadonlyMap<string | symbol, RouteHandler>;

/**
 * What a route-local `error` hook is given: the request's own context with the
 * thrown value on it.
 *
 * Elysia hands an error hook the fields a handler reads, so the platform states
 * the context it already publishes plus the one member an error hook is for.
 */
export interface ElysiaRouteErrorContext extends RouteContext {
  /** The thrown value, exactly as it was thrown, because anything can be thrown. */
  readonly error: unknown;
}

/**
 * One entry of a route's own `error` array.
 *
 * Elysia runs the array in order and the first entry whose return value it can
 * answer with answers the request; the rest never run. `undefined` and `null`
 * are the two values Elysia's error path reads as no answer, so returning either
 * declines and leaves the decision to the entry behind it — every other value,
 * `false`, `0`, and `""` included, becomes the response.
 *
 * @internal
 */
export type ElysiaErrorHook = (context: ElysiaRouteErrorContext) => unknown;

/**
 * What a route-local `afterHandle` hook is given: the request's own context with
 * the handler's result on it.
 *
 * Elysia sets `response` on the context before the hook runs, and to whatever a
 * returning hook ahead of it answered, so an after half reads the current
 * response from here rather than receiving it as an argument.
 *
 * @internal
 */
export interface ElysiaRouteAfterHandleContext extends RouteContext {
  /**
   * The handler's result, or what an earlier after half answered with.
   *
   * Elysia 1.4 called this field `response`; Elysia 2 hands the same value under
   * `responseValue`.
   */
  readonly responseValue: unknown;
}

/**
 * The hook object one route is registered with.
 *
 * Elysia splits it across two types — `InputSchema` holds the validators, while
 * the lifecycle members live on the route hook — and a route is registered with
 * one object carrying both. Members are added here as the platform compiles
 * them, so `routing/native-route.ts` never has to widen the native signature.
 *
 * @internal
 */
export interface ElysiaRouteHook extends InputSchema<never> {
  /** Runs before the handler, and answers the request instead of it when it throws or refuses. */
  beforeHandle?(context: RouteContext): unknown;
  /**
   * Runs after the handler, and answers with what the response should carry.
   * Elysia replaces the response with a value this returns, and keeps the
   * handler's own when it answers `undefined`.
   */
  afterHandle?(context: ElysiaRouteAfterHandleContext): Promise<unknown>;
  /**
   * Runs when the handler or one of the route's own hooks threw. The declared
   * filters come first and the Problem Details mapping last, so a filter ahead
   * of the mapping answers in its place.
   */
  error?: ElysiaErrorHook[];
}

/**
 * Immutable route information produced from decorator metadata before a
 * controller instance is mounted.
 *
 * @internal
 */
export interface CompiledElysiaRoute {
  readonly method: RequestMethod;
  readonly path: string;
  readonly propertyKey: string | symbol;
  readonly parameters: readonly RouteParameterMetadata[];
  readonly capabilities: readonly RouteParameterKind[];
  readonly schema: RouteSchema | undefined;
  readonly declaredParameterCount: number | undefined;
  readonly declaredReturnKind: "promise" | "synchronous" | "unknown";
  /** Emitted TypeScript parameter types if decorator metadata was available. */
  readonly declaredParameterTypes?: readonly unknown[];
  /** The pipes applied to this route from controller and method levels. */
  readonly pipes?: readonly PipeType[];
  /** The enhancers this route declares, before any global ones are merged. */
  readonly enhancers: EnhancerMetadata;
}
