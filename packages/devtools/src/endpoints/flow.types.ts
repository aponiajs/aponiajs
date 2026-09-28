import type { RouteSchemaSlot } from "@aponiajs/common";
import type { AponiaRouteParameterInspection } from "@aponiajs/platform-elysia";
import type { AponiaRouteSource } from "./payloads.types.ts";

/**
 * The step of a route's chain one stage states.
 *
 * The first four are what Elysia already holds about the mounted route: a
 * plugin's `derive` and `resolve` are the phases the framework reaches for
 * instead of middleware, `hook` is any other lifecycle hook a plugin
 * contributed, and `validate` is a slot the route's schema declares. The rest
 * belong to the route's compiled plan: `guard`, `interceptBefore`,
 * `interceptAfter`, and `bind` are the parts the platform lowered into one
 * `beforeHandle` and one `afterHandle`, while `invoke` and `handler` say what
 * serves the route and what it calls.
 */
export type AponiaFlowStageKind =
  | "derive"
  | "validate"
  | "resolve"
  | "hook"
  | "guard"
  | "interceptBefore"
  | "bind"
  | "invoke"
  | "handler"
  | "interceptAfter";

/**
 * Which declaration put a stage on the route.
 *
 * `"global"` is the application's own declaration, which resolves once through
 * the root module and reaches every route the platform mounts; `"local"` is the
 * controller's and the handler's. The same two values describe a contributed
 * hook's scope, where Elysia's own `"scoped"` arrives normalized to `"local"`:
 * a hook scoped to the plugin that contributed it reaches that plugin's own
 * routes and the ones mounted beside it, which is the local half of the same
 * distinction.
 */
export type AponiaFlowScope = "global" | "local";

/**
 * One step of the chain, with the stages that run after it named explicitly.
 *
 * The fields a stage carries follow its kind, and a field is present only when
 * the stage's own source states it: a stage that names no class carries no
 * `enhancer`, and a route whose handler property key no record holds carries no
 * `handler` name. Absence is therefore a statement — "nothing states this" —
 * rather than an empty value a reader has to interpret.
 */
export interface AponiaFlowStage {
  /**
   * An identifier that is stable and unique within one response, and that every
   * `next` of the same route refers to by. A renderer keys its nodes by it; it
   * is not a cross-response identity, because a stage is assembled per request
   * from a mounted table that may have changed.
   */
  readonly id: string;
  /** Which step of the chain this stage is. */
  readonly kind: AponiaFlowStageKind;
  /** Which scope runs the stage. Absent on the kinds no declaration owns. */
  readonly scope?: AponiaFlowScope;
  /**
   * The class a `guard` or `intercept*` stage runs. The platform resolved that
   * class itself, so its name is one it can state.
   */
  readonly enhancer?: string;
  /** The schema slot a `validate` stage validates. */
  readonly slot?: RouteSchemaSlot;
  /**
   * The `@Validation()` class the slot resolved to, when the compiled plan
   * still holds the class rather than a raw validator. A validator a route
   * declared directly names no model, which is what its absence states.
   */
  readonly model?: string;
  /**
   * The context fields a `bind` stage passes, in declaration order. Present
   * only on a `bind` stage, which is published only when the route binds at
   * least one field.
   */
  readonly parameters?: readonly AponiaRouteParameterInspection[];
  /**
   * A stable identity for a contributed hook — the phase it runs in, its kind,
   * its scope, and the checksum Elysia stamps — so the same hook reaching two
   * routes reports one value. Absent when the hook carries no checksum: nothing
   * would group it, and a per-route label would be the opposite of an identity.
   * Never a plugin name, because the plugin that contributed a hook is not
   * carried on the route.
   */
  readonly hook?: string;
  /**
   * Which binding serves the route, published on the `invoke` stage — the one
   * kind that carries it — and stated in the same three values `/routes` states
   * for the same fact: `"generated"` for a build-time invoker, `"compiled"` for
   * the running platform's own compilation or for a route a callback mounted,
   * and `null` when no boot recorded a binding for the route, or recorded one
   * this release cannot name. `null` never means "an unknown binding"; a guess
   * published where a decided state belongs would make one boot's routes look
   * interchangeable with another's.
   */
  readonly source?: AponiaRouteSource;
  /** The controller whose method serves the route, when a record names one. */
  readonly controller?: string;
  /**
   * The handler's property key as the platform projects it — `String(key)`, so
   * a symbol key reads as `Symbol(description)` — when a compiled plan states
   * one.
   */
  readonly handler?: string;
  /**
   * The stages that run after this one, in the order they run. Stated
   * explicitly rather than left implicit, so a renderer draws the graph instead
   * of assuming a chain: today's stages form one, and only the stages whose
   * source can branch will ever name more than one successor.
   */
  readonly next: readonly string[];
}

/**
 * One entry of a route's `error` array.
 *
 * Filters are not stages. They run when a guard or the handler threw, so a
 * stage in the chain would claim something every request runs. They are listed
 * in the order the route's own array runs them — the first entry that answers
 * is the one that decides.
 */
export interface AponiaFlowFilter {
  /**
   * `"filter"` for a declared filter, `"default"` for the Problem Details
   * mapping every route the platform compiles carries last.
   */
  readonly kind: "filter" | "default";
  /** The filter class, or the mapping the platform answers unhandled failures with. */
  readonly name: string;
  /** The declaration that contributed a declared filter. Absent on the mapping. */
  readonly scope?: AponiaFlowScope;
  /**
   * What `@Catch()` named on a declared filter, as class names. An empty list
   * is a filter that declared no type and answers anything, which is what
   * `@Catch()` with no arguments means. Absent on the mapping, which is not
   * declared and matched by nothing.
   */
  readonly catch?: readonly string[];
}

/**
 * One route the running application answers, as the chain it passes through.
 *
 * `id` is the method and the path the mounted table reports, folded the way
 * `/routes` folds them, so a consumer joins the two payloads without a second
 * rule. `filters` states the route's own `error` array, which is why it is a
 * list on the route rather than a stage in the chain.
 */
export interface AponiaFlowRoute {
  /** The method the mounted table reports, upper-cased, and the path it mounted. */
  readonly id: string;
  /** The stages the route runs, in the order it runs them. */
  readonly stages: readonly AponiaFlowStage[];
  /** The route's filters, ordered exactly as its own `error` array is. */
  readonly filters: readonly AponiaFlowFilter[];
}

/**
 * The payload `/__devtools/flow` answers with: every mounted route, with the
 * stages it passes through and the filters that answer when it throws.
 *
 * The stages are read from two sources, and each one owns what it states. The
 * mounted route entry owns the hooks and the schema slots Elysia itself holds —
 * a plugin's `derive`, `resolve`, and lifecycle hooks, and the slots the route
 * validates — which is why this payload is assembled per request rather than
 * built once for the application: that entry belongs to the running
 * application. The boot
 * record owns the compiled plan, which is the only place a route's guards and
 * interceptors are still separate, and the application's own enhancer
 * declaration, which no plan carries.
 *
 * A route neither source describes is still reported, with the stages its own
 * entry states and nothing else: the table is what the application answers, and
 * a route dropped from this payload would be a route a consumer cannot see at
 * all. A WebSocket route is one of those — the stage vocabulary describes the
 * HTTP chain, so such a route publishes the hooks its entry carries and no
 * stage the vocabulary would have to invent.
 *
 * Route entries are sorted by path and then method, in code-unit order, so the
 * payload is deterministic and two polls of one server answer the same order.
 */
export interface AponiaFlowPayload {
  /** Every mounted route, sorted by path and then method. */
  readonly routes: readonly AponiaFlowRoute[];
}
