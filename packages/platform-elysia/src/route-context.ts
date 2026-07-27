import type { Context, InputSchema, UnwrapRoute } from "elysia";

/**
 * The native Elysia request context for a declared route schema. Handlers that
 * take the whole context — through `@Ctx()` or a single unannotated parameter —
 * keep `status`, `set`, `cookie`, `store`, `redirect`, and plugin decorators
 * fully typed.
 */
export type ElysiaRouteContext<TSchema extends InputSchema = {}> = Context<
  UnwrapRoute<TSchema, {}, string>
>;
