import {
  getCatchMetadata,
  getValidationMetadata,
  routeSchemaSlots,
  tokenName,
  type ClassToken,
  type EnhancerMetadata,
  type RouteSchemaSlot,
  type ValidationModelClass,
} from "@aponiajs/common";
import type {
  AponiaApplicationDiagnostics,
  AponiaCallbackRouteDiagnostics,
  AponiaCompiledRouteDiagnostics,
  AponiaRouteParameterInspection,
  InterceptorHalves,
} from "@aponiajs/platform-elysia";
import type { Elysia } from "elysia";
import type {
  AponiaFlowFilter,
  AponiaFlowPayload,
  AponiaFlowRoute,
  AponiaFlowScope,
  AponiaFlowStage,
  AponiaFlowStageKind,
} from "./flow.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsFlowPath = "/flow";

/**
 * The name the payload publishes for the mapping every compiled route ends
 * with.
 *
 * No class names it: the mapping is built from the boot's system logger and
 * compiled into each route while it mounts, so there is no token a consumer
 * could resolve. The payload states the role it plays rather than a class name
 * that would look resolvable.
 */
const problemDetailsMappingName = "ProblemDetailsMapping";

/**
 * The three fields of a mounted route entry this endpoint reads.
 *
 * They are `unknown` on purpose: the entry belongs to the installed Elysia
 * rather than to this release, and a devtools endpoint that trusted a shape it
 * did not write would fail a request over a field it never reports.
 */
interface MountedNativeRoute {
  readonly method: unknown;
  readonly path: unknown;
  readonly hooks: unknown;
}

/**
 * One entry of a lifecycle array, as the table may hold it.
 *
 * `subType` is what Elysia stamps on a hook it built from a higher-level API —
 * `"derive"` for a plugin's `derive`, `"resolve"` for its `resolve` — while
 * `scope` and `checksum` are what it stamps on a hook it can identify at all.
 * The platform's own compiled hook carries none of the three, which is how this
 * endpoint tells the two apart.
 *
 * That discriminator is a statement about a release this package does not own,
 * so it is re-checked whenever the Elysia peer range moves: it holds because
 * Elysia stamps a scope on every hook an instance-level API contributes —
 * `"local"` when the caller declares none — and a checksum on the hooks of a
 * named plugin. An Elysia release that stopped stamping a scope on an unscoped
 * contribution would leave that hook indistinguishable from the compiled one,
 * and it would drop out of this payload silently.
 */
interface ContributedHook {
  readonly subType: unknown;
  readonly scope: unknown;
  readonly checksum: unknown;
}

/** One enhancer with the scope that declared it. */
interface ScopedEnhancer {
  readonly token: ClassToken<unknown>;
  readonly scope: AponiaFlowScope;
}

/** One half of the interceptor lifecycle, as a stage kind. */
type InterceptorHalf = "interceptBefore" | "interceptAfter";

/** A stage before the graph wires it: everything but its id and its successor. */
type StageDraft = Omit<AponiaFlowStage, "id" | "next">;

/** One route with the two keys the payload states its order by. */
interface OrderedRoute {
  readonly path: string;
  readonly method: string;
  readonly route: AponiaFlowRoute;
}

const emptyHooks: readonly ContributedHook[] = Object.freeze([]);
const emptyEnhancers: EnhancerMetadata = Object.freeze({
  guards: Object.freeze([]),
  interceptors: Object.freeze([]),
  filters: Object.freeze([]),
});

/**
 * Builds the payload `/flow` answers with, from the mounted routes the
 * application holds at this moment and the plans the boot recorded for them.
 *
 * The mounted table is read when the request arrives rather than kept from the
 * boot, for the same reason `/routes` reads it then: a plugin's hooks and a
 * route's schema slots live on that table, it belongs to the running
 * application, and an application may mount another route on its native
 * instance before it listens. The record arrives already read, because a boot
 * does not change once it has started.
 *
 * A route's enhancers come from its compiled plan and never from the hook the
 * platform compiled them into: that hook is one function per half, and which
 * guard or interceptor a part of it belongs to is legible only while the plan's
 * own lists are. A compiled hook is therefore published as its parts, and never
 * as a contributed hook stage.
 *
 * Nothing here may throw. This handler answers inside `Bun.serve`, where a
 * throw is a failed request, and both sources are data this release did not
 * write — the table belongs to the installed Elysia and the record arrives
 * through a registry-global symbol key. Every field is read as the unknown it
 * is and stated as an absence rather than dereferenced, so a foreign route or a
 * foreign record costs a field rather than the whole report.
 */
export function buildFlowPayload(
  application: Elysia,
  diagnostics: AponiaApplicationDiagnostics | undefined,
): AponiaFlowPayload {
  const plans = readCompiledPlans(diagnostics);
  const callbacks = readCallbackRoutes(diagnostics);
  const global = readEnhancers(diagnostics?.globalEnhancers);
  const halves = readInterceptorHalves(diagnostics?.interceptorHalves);
  const routes: OrderedRoute[] = [];

  for (const mounted of readMountedRoutes(application)) {
    const { method, path } = mounted;
    if (typeof method !== "string" || typeof path !== "string") {
      continue;
    }

    const id = routeKey(method, path);
    const plan = plans.get(id);
    const callback = callbacks.get(id);
    const drafts = buildStageDrafts(mounted, plan, callback, global, halves);

    routes.push(
      Object.freeze({
        path,
        method: method.toUpperCase(),
        route: Object.freeze({
          id,
          stages: publishStages(id, drafts),
          filters: describeFilters(plan, global),
        }),
      }),
    );
  }

  routes.sort(compareOrderedRoutes);

  return Object.freeze({ routes: Object.freeze(routes.map((entry) => entry.route)) });
}

/**
 * The stages one mounted route runs, in the order it runs them.
 *
 * The order is the one the code states. Elysia's own contributions come first,
 * because Elysia runs a route's `transform` hooks and its validation ahead of
 * the compiled hook the platform mounts last. The guards and the before halves
 * follow, each scope in declaration order with the application's own first,
 * because that is the order the platform compiled them into that one hook. Then
 * the binding, the binding that serves the route, and the controller's method;
 * then whatever a plugin contributed to the after phase, which Elysia runs
 * before the platform's compiled `afterHandle`; and last the after halves over
 * the whole interceptor list reversed, so the outermost interceptor's half runs
 * last.
 *
 * Each half is published for the interceptors that declare it and no others: the
 * platform calls them with an optional call, so a class that implements one half
 * runs one half. Which half a class implements is the boot's own record, read
 * from the instance the platform calls and falling back to the class token's
 * `prototype` for a record that carries none.
 */
function buildStageDrafts(
  mounted: MountedNativeRoute,
  plan: AponiaCompiledRouteDiagnostics | undefined,
  callback: AponiaCallbackRouteDiagnostics | undefined,
  global: EnhancerMetadata,
  recorded: ReadonlyMap<ClassToken<unknown>, InterceptorHalves> | undefined,
): readonly StageDraft[] {
  const hooks = readHooks(mounted.hooks);
  const declared = readEnhancers(plan?.route.enhancers);
  // The application's own declaration merges into the routes the platform
  // mounts from a plan and into no others: a route a controller's callback
  // mounted, and one mounted on the native instance, carry no compiled hook for
  // it to merge into, so publishing it here would claim an enhancer that never
  // runs for that route.
  const inherited = plan === undefined ? emptyEnhancers : global;
  const drafts: StageDraft[] = [];
  const interceptors: readonly ScopedEnhancer[] = Object.freeze([
    ...scopedEnhancers(inherited.interceptors, "global"),
    ...scopedEnhancers(declared.interceptors, "local"),
  ]);

  appendContributedStages(drafts, hooks.transform, "transform");
  appendValidationStages(drafts, hooks, plan);
  appendContributedStages(drafts, hooks.beforeHandle, "beforeHandle");
  appendEnhancerStages(drafts, scopedEnhancers(inherited.guards, "global"), "guard");
  appendEnhancerStages(drafts, scopedEnhancers(declared.guards, "local"), "guard");
  appendEnhancerStages(
    drafts,
    declaringHalf(interceptors, "interceptBefore", recorded),
    "interceptBefore",
  );
  appendParameterBinding(drafts, plan);

  const described = plan ?? callback;
  if (described !== undefined) {
    drafts.push({ kind: "invoke", source: described.source ?? null });
    drafts.push(describeHandler(described, plan));
  }

  appendContributedStages(drafts, hooks.afterHandle, "afterHandle");
  appendEnhancerStages(
    drafts,
    Object.freeze([...declaringHalf(interceptors, "interceptAfter", recorded)].reverse()),
    "interceptAfter",
  );

  return drafts;
}

/**
 * Whatever Elysia contributed to one lifecycle array, as a stage each.
 *
 * An entry this release can identify is one Elysia stamped a scope or a
 * checksum on. Everything else in the array belongs to whoever mounted the
 * route and carries no identity to report: on a route the platform compiled,
 * that is the compiled hook itself, which is published as its parts and never
 * here.
 */
function appendContributedStages(
  drafts: StageDraft[],
  entries: unknown,
  phase: "transform" | "beforeHandle" | "afterHandle",
): void {
  for (const entry of readHookEntries(entries)) {
    const scope = normalizeScope(entry.scope);
    const checksum = typeof entry.checksum === "number" ? entry.checksum : undefined;

    if (scope === undefined && checksum === undefined) {
      continue;
    }

    const kind = contributedKind(entry.subType);

    drafts.push({
      kind,
      ...(scope === undefined ? {} : { scope }),
      ...(checksum === undefined ? {} : { hook: hookIdentity(phase, kind, scope, checksum) }),
    });
  }
}

/**
 * One stage per schema slot the mounted entry already holds a validator for,
 * with the model the compiled plan names.
 *
 * The entry states which slots run, because Elysia binds a lowered validator to
 * the route and runs it; the plan states whether that validator arrived as a
 * `@Validation()` class, because the entry holds the lowered validator alone and
 * the class it came from survives nowhere else.
 */
function appendValidationStages(
  drafts: StageDraft[],
  hooks: Readonly<Record<string, unknown>>,
  plan: AponiaCompiledRouteDiagnostics | undefined,
): void {
  for (const slot of routeSchemaSlots) {
    if (hooks[slot] === undefined) {
      continue;
    }

    const model = readModelName(plan?.route.schema, slot);
    drafts.push({ kind: "validate", slot, ...(model === undefined ? {} : { model }) });
  }
}

/** One stage per enhancer, in the order the list declares them. */
function appendEnhancerStages(
  drafts: StageDraft[],
  enhancers: readonly ScopedEnhancer[],
  kind: "guard" | "interceptBefore" | "interceptAfter",
): void {
  for (const { token, scope } of enhancers) {
    drafts.push({ kind, scope, enhancer: tokenName(token) });
  }
}

/**
 * The binding stage, published only when the route binds at least one field.
 *
 * A stage is published only when the route runs it, and a handler that declares
 * no decorated parameter binds none of them: the compiled invoker calls the
 * controller with no argument list, so there is no binding step to report and
 * an empty one would state its own absence.
 */
function appendParameterBinding(
  drafts: StageDraft[],
  plan: AponiaCompiledRouteDiagnostics | undefined,
): void {
  const parameters = freezeParameters(plan?.route.parameters);

  if (parameters.length > 0) {
    drafts.push({ kind: "bind", parameters });
  }
}

/**
 * The controller's method, as the record names it.
 *
 * A name the record cannot state is left out rather than filled in: a route a
 * controller's callback or plugin mounted names its controller and no handler,
 * because the property key that built it exists only while the mount runs, and
 * a route whose plan states no usable key names neither. The field's absence is
 * the absence, which is why it is not published as an empty string.
 */
function describeHandler(
  described: AponiaCompiledRouteDiagnostics | AponiaCallbackRouteDiagnostics,
  plan: AponiaCompiledRouteDiagnostics | undefined,
): StageDraft {
  const controller = readName(described.controller);
  const handler = plan === undefined ? "" : handlerName(plan.route.propertyKey);

  return {
    kind: "handler",
    ...(controller === undefined ? {} : { controller }),
    ...(handler === "" ? {} : { handler }),
  };
}

/**
 * The route's own `error` array, in the order it runs.
 *
 * The declared filters come first and the application's own behind them, which
 * is the reverse of the guard order for the same reason: the most specific
 * declaration is the one that decides, and the first entry that answers is the
 * one that answers. The mapping every compiled route carries comes last because
 * it declines everything a filter ahead of it or Elysia's own error path
 * answers.
 *
 * A route the record describes with no plan carries no list at all: the
 * platform compiles that array only for the routes it mounts from a plan, so a
 * callback's route has none to report.
 */
function describeFilters(
  plan: AponiaCompiledRouteDiagnostics | undefined,
  global: EnhancerMetadata,
): readonly AponiaFlowFilter[] {
  if (plan === undefined) {
    return Object.freeze([]);
  }

  const filters: AponiaFlowFilter[] = [];

  for (const token of readEnhancers(plan.route.enhancers).filters) {
    filters.push(describeFilter(token, "local"));
  }

  for (const token of global.filters) {
    filters.push(describeFilter(token, "global"));
  }

  filters.push(Object.freeze({ kind: "default", name: problemDetailsMappingName }));

  return Object.freeze(filters);
}

/** One declared filter, with the types its own `@Catch()` named. */
function describeFilter(token: ClassToken<unknown>, scope: AponiaFlowScope): AponiaFlowFilter {
  return Object.freeze({
    kind: "filter",
    name: tokenName(token),
    scope,
    catch: Object.freeze(getCatchMetadata(token).map((exception) => tokenName(exception))),
  });
}

/**
 * The drafts as the payload publishes them: one frozen stage per step, each
 * naming the stage behind it.
 *
 * The ids are derived from the route's own id and the stage's position in the
 * chain, so they are unique within the response and every `next` of the route
 * refers to one this payload declares. `next` is stated on every stage rather
 * than assumed from the order, because a stage whose source can branch — a
 * validation slot, a guard, the invoke — will state more than one successor,
 * and a renderer should never have to know that today's chain is linear.
 */
function publishStages(id: string, drafts: readonly StageDraft[]): readonly AponiaFlowStage[] {
  return Object.freeze(
    drafts.map((draft, index) =>
      Object.freeze({
        id: `${id}#${index}`,
        ...draft,
        next: Object.freeze(
          index + 1 < drafts.length ? [`${id}#${index + 1}`] : ([] as readonly string[]),
        ),
      }),
    ),
  );
}

/**
 * What the boot recorded about each route it mounted from a plan, keyed by the
 * method and path the mounted table joins on.
 */
function readCompiledPlans(
  diagnostics: AponiaApplicationDiagnostics | undefined,
): ReadonlyMap<string, AponiaCompiledRouteDiagnostics> {
  const plans = new Map<string, AponiaCompiledRouteDiagnostics>();

  for (const entry of recordedEntries<AponiaCompiledRouteDiagnostics>(diagnostics?.routes)) {
    const plan = entry?.route;
    if (typeof plan?.method !== "string" || typeof plan.path !== "string") {
      continue;
    }

    plans.set(routeKey(plan.method, plan.path), entry);
  }

  return plans;
}

/**
 * The routes a controller mounted itself, keyed the same way. Those entries
 * carry no plan, so they state the controller that mounted the route and the
 * binding the boot decided on and nothing about its stages.
 */
function readCallbackRoutes(
  diagnostics: AponiaApplicationDiagnostics | undefined,
): ReadonlyMap<string, AponiaCallbackRouteDiagnostics> {
  const callbacks = new Map<string, AponiaCallbackRouteDiagnostics>();

  for (const entry of recordedEntries<AponiaCallbackRouteDiagnostics>(
    diagnostics?.callbackRoutes,
  )) {
    if (typeof entry?.method !== "string" || typeof entry.path !== "string") {
      continue;
    }

    callbacks.set(routeKey(entry.method, entry.path), entry);
  }

  return callbacks;
}

/**
 * One enhancer declaration as a walkable list of classes.
 *
 * The record arrives through a registry-global symbol key, so a declaration a
 * foreign copy wrote is not the shape this release holds: a list that is not a
 * list and an entry that is not a class are both stated as no enhancer rather
 * than dereferenced.
 */
function readEnhancers(metadata: unknown): EnhancerMetadata {
  if (typeof metadata !== "object" || metadata === null) {
    return emptyEnhancers;
  }

  const declaration = metadata as Record<string, unknown>;
  const guards = readClassList(declaration.guards);
  const interceptors = readClassList(declaration.interceptors);
  const filters = readClassList(declaration.filters);

  if (guards.length === 0 && interceptors.length === 0 && filters.length === 0) {
    return emptyEnhancers;
  }

  return Object.freeze({ guards, interceptors, filters });
}

function readClassList(value: unknown): readonly ClassToken<unknown>[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  return Object.freeze(
    value.filter((entry): entry is ClassToken<unknown> => typeof entry === "function"),
  );
}

/** The mounted table as this endpoint reads it, for the same reasons `/routes` checks it. */
function readMountedRoutes(application: Elysia): readonly MountedNativeRoute[] {
  const mounted: readonly MountedNativeRoute[] = application.routes;

  return Array.isArray(mounted) ? mounted : [];
}

/** One route's hook object, or an empty one when the entry holds no walkable object. */
function readHooks(hooks: unknown): Readonly<Record<string, unknown>> {
  return typeof hooks === "object" && hooks !== null
    ? (hooks as Readonly<Record<string, unknown>>)
    : Object.freeze({});
}

function readHookEntries(value: unknown): readonly ContributedHook[] {
  if (!Array.isArray(value)) {
    return emptyHooks;
  }

  return value.filter(
    (entry): entry is ContributedHook => typeof entry === "object" && entry !== null,
  );
}

/**
 * Elysia's own scope as this payload states it.
 *
 * `"scoped"` is normalized to `"local"` because that is what the two mean for a
 * route: a hook scoped to the plugin that contributed it reaches that plugin's
 * own routes and the ones mounted beside it, which is exactly the reach of a
 * local declaration. Any other value is not a scope this release knows, so the
 * stage states no scope rather than a guess.
 */
function normalizeScope(scope: unknown): AponiaFlowScope | undefined {
  if (scope === "global") {
    return "global";
  }

  return scope === "local" || scope === "scoped" ? "local" : undefined;
}

/** The stage kind a contributed hook's own subType describes. */
function contributedKind(subType: unknown): AponiaFlowStageKind {
  if (subType === "derive") {
    return "derive";
  }

  return subType === "resolve" ? "resolve" : "hook";
}

/**
 * A contributed hook's identity: the phase it runs in, the kind its subType
 * describes, the scope it reached this route with, and the checksum Elysia
 * stamped on it.
 *
 * The checksum is what groups one hook across every route it reaches, and the
 * other three parts separate two hooks of one plugin that share it — a plugin
 * that contributes a `beforeHandle` hook and an `afterHandle` hook carries the
 * same checksum on both. Two hooks of one kind in one phase of one plugin
 * remain one identity, because nothing on the route tells them apart.
 */
function hookIdentity(
  phase: "transform" | "beforeHandle" | "afterHandle",
  kind: AponiaFlowStageKind,
  scope: AponiaFlowScope | undefined,
  checksum: number,
): string {
  return [phase, kind, ...(scope === undefined ? [] : [scope]), String(checksum)].join(":");
}

/** The `@Validation()` class a compiled plan's slot names, when it names one. */
function readModelName(schema: unknown, slot: RouteSchemaSlot): string | undefined {
  if (typeof schema !== "object" || schema === null) {
    return undefined;
  }

  const validator = (schema as Record<string, unknown>)[slot];
  if (typeof validator !== "function") {
    return undefined;
  }

  const model = validator as ValidationModelClass;

  return getValidationMetadata(model) === undefined ? undefined : tokenName(model);
}

/** One enhancer per declaration, each carrying the scope that declared it. */
function scopedEnhancers(
  tokens: readonly ClassToken<unknown>[],
  scope: AponiaFlowScope,
): readonly ScopedEnhancer[] {
  return tokens.map((token) => Object.freeze({ token, scope }));
}

/**
 * The interceptors of one list whose class declares the half a stage states.
 *
 * The platform calls both halves with an optional call — `interceptor
 * .interceptBefore?.(…)` — so an interceptor that declares one half runs one
 * half, and a stage for the other would state something the route never runs.
 * The class the plan names is what this reads, answered by the halves the boot
 * recorded for that class and, failing that, by the class's own `prototype`.
 */
function declaringHalf(
  enhancers: readonly ScopedEnhancer[],
  half: InterceptorHalf,
  recorded: ReadonlyMap<ClassToken<unknown>, InterceptorHalves> | undefined,
): readonly ScopedEnhancer[] {
  return Object.freeze(enhancers.filter(({ token }) => declaresHalf(token, half, recorded)));
}

/**
 * Whether a class declares one half of the interceptor lifecycle.
 *
 * The recorded halves answer first, and they are the ones the route actually
 * runs: they were read from the instance the platform calls, while building the
 * mount, so a half declared as a class field — an own property of that instance
 * and of no class token — is stated by them.
 *
 * The `prototype` probe is the fallback for a record that carries no halves: a
 * copy of the platform older than this release, or one this package does not
 * own. It answers from the class the token names rather than from the instance
 * the platform calls, so it is the narrower answer: it publishes a half only
 * when that token declares one on its `prototype`, which leaves a field-declared
 * half out instead of inventing one. A token that is not a class declares
 * neither half, and a stage left out costs a stage rather than the request.
 */
function declaresHalf(
  token: ClassToken<unknown>,
  half: InterceptorHalf,
  recorded: ReadonlyMap<ClassToken<unknown>, InterceptorHalves> | undefined,
): boolean {
  const declared = recordedHalf(recorded?.get(token), half);
  if (declared !== undefined) {
    return declared;
  }

  const members = (token as { readonly prototype?: unknown }).prototype;

  return (
    typeof members === "object" &&
    members !== null &&
    typeof (members as Record<string, unknown>)[half] === "function"
  );
}

/**
 * The halves a record states for one class, or `undefined` when it states none
 * this release can read.
 *
 * The field is read defensively because the record arrives through a
 * registry-global symbol key and its entries are data this release did not
 * necessarily write: an entry that is not an object, and one whose half is not a
 * boolean, both read as no halves rather than being dereferenced or reported as
 * a stage. Every other shape reaches the `prototype` fallback above, which is
 * what a record with no halves at all reaches too.
 */
function recordedHalf(value: unknown, half: InterceptorHalf): boolean | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const members = value as Record<string, unknown>;
  const declared = half === "interceptBefore" ? members.before : members.after;

  return typeof declared === "boolean" ? declared : undefined;
}

/**
 * The boot's record of which interceptor halves each class implements, or
 * `undefined` when the record carries none.
 *
 * The field is `unknown` at this boundary for the reason the rest of the record
 * is read as unknown: it belongs to a copy of the platform this package does not
 * own, so a copy older than the field leaves it out and a foreign one may hold
 * something else under the name. A value that is not a `Map` reads as no halves,
 * and every decision then falls back to the class token's `prototype`.
 */
function readInterceptorHalves(
  value: unknown,
): ReadonlyMap<ClassToken<unknown>, InterceptorHalves> | undefined {
  return value instanceof Map
    ? (value as ReadonlyMap<ClassToken<unknown>, InterceptorHalves>)
    : undefined;
}

/**
 * The parameters as the payload publishes them: one frozen copy per bound
 * field, so a reader of the wire shape can never be handed part of a record to
 * mutate.
 */
function freezeParameters(
  parameters: readonly AponiaRouteParameterInspection[] | undefined,
): readonly AponiaRouteParameterInspection[] {
  if (!Array.isArray(parameters)) {
    return Object.freeze([]);
  }

  return Object.freeze(
    parameters.map((parameter) =>
      Object.freeze({
        index: parameter.index,
        kind: parameter.kind,
        property: parameter.property,
      }),
    ),
  );
}

/**
 * A handler's property key as the payload spells it, or the empty string when
 * the record states none. `String(key)` is the projection the platform's own
 * inspection and `/routes` both use, so a symbol key stays readable.
 */
function handlerName(propertyKey: unknown): string {
  return typeof propertyKey === "string" || typeof propertyKey === "symbol"
    ? String(propertyKey)
    : "";
}

/** A name a record states, or `undefined` when what it states is not one. */
function readName(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The key a mounted route and a record entry are joined on. The method is folded
 * to upper case, as `/routes` folds it, so both payloads name one route by one
 * id.
 */
function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * A record's entries as a walkable list: the record arrives through a
 * registry-global symbol key, and a copy of the platform older than a
 * collection answers the same key without it.
 */
function recordedEntries<TEntry>(entries: readonly TEntry[] | undefined): readonly TEntry[] {
  return Array.isArray(entries) ? entries : [];
}

/**
 * The order the payload states: path, then method, each compared by code unit
 * so every runtime orders identically. The mounted table cannot hold two routes
 * under one method and path, so the two keys are a total order.
 */
function compareOrderedRoutes(left: OrderedRoute, right: OrderedRoute): number {
  return compareText(left.path, right.path) || compareText(left.method, right.method);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
