/**
 * A route handler compiled outside the platform, already bound to its
 * controller instance.
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
