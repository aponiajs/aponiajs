import {
  getCatchMetadata,
  getTokenName,
  getValidationMetadata,
  routeSchemaSlots,
  type ClassToken,
  type EnhancerMetadata,
  type RouteSchemaSlot,
  type ValidationModelClass,
} from "@aponiajs/common";
import type { AponiaBootDiagnostics } from "@aponiajs/common";
import type {
  AponiaRouteStage,
  AponiaRouteStageKind,
  AponiaRouteStageScope,
  AponiaRouteTrace,
  AponiaRouteTraceFilter,
  AponiaRouteTracePayload,
} from "../interfaces/flow.interface.ts";
import { readRouteParameters } from "./route-parameters.ts";
import { readRouteSource } from "./route-source.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsFlowPath = "/flow";

const problemDetailsMappingName = "ProblemDetailsMapping";

interface ScopedEnhancer {
  readonly token: ClassToken<unknown>;
  readonly scope: AponiaRouteStageScope;
}

type InterceptorHalf = "interceptBefore" | "interceptAfter";
type RecordedInterceptorPhases = ReadonlyMap<
  ClassToken<unknown>,
  { before: boolean; after: boolean }
>;

type StageDraft = Omit<AponiaRouteStage, "id" | "next">;

interface OrderedRoute {
  readonly path: string;
  readonly method: string;
  readonly route: AponiaRouteTrace;
}

const emptyEnhancers: EnhancerMetadata = Object.freeze({
  guards: Object.freeze([]),
  interceptors: Object.freeze([]),
  filters: Object.freeze([]),
});

/**
 * Builds the payload `/flow` answers with from the neutral boot record.
 *
 * A route's stages come from its compiled plan and the application's own
 * enhancer declaration. The platform's contributed hooks are not part of the
 * neutral record, so a plugin's `transform`, `beforeHandle`, or `afterHandle`
 * declaration is not published on any platform — the documented degradation of
 * this endpoint. Validation stages are published for the slots the plan declares,
 * rather than for the slots a native route entry happens to hold.
 */
export function buildFlowPayload(
  diagnostics: AponiaBootDiagnostics | undefined,
): AponiaRouteTracePayload {
  const global = readEnhancers(diagnostics?.globalEnhancers);
  const halves = diagnostics?.interceptorHalves;
  const routes: OrderedRoute[] = [];

  for (const entry of diagnostics?.routes ?? []) {
    const plan = entry.route;
    const id = routeKey(plan.method, plan.path);
    const drafts = buildPlanStages(plan, global, halves);
    routes.push(
      Object.freeze({
        path: plan.path,
        method: plan.method.toUpperCase(),
        route: Object.freeze({
          id,
          stages: publishStages(id, drafts),
          filters: describeFilters(plan, global),
        }),
      }),
    );
  }

  for (const entry of diagnostics?.callbackRoutes ?? []) {
    const id = routeKey(entry.method, entry.path);
    if (routes.some((candidate) => candidate.route.id === id)) {
      continue;
    }
    routes.push(
      Object.freeze({
        path: entry.path,
        method: entry.method.toUpperCase(),
        route: Object.freeze({
          id,
          stages: publishStages(id, [
            { kind: "invoke", source: readRouteSource(entry.source) },
            {
              kind: "handler",
              ...(entry.controller === "" ? {} : { controller: entry.controller }),
            },
          ]),
          filters: Object.freeze([]),
        }),
      }),
    );
  }

  routes.sort(compareOrderedRoutes);

  return Object.freeze({ routes: Object.freeze(routes.map((entry) => entry.route)) });
}

function buildPlanStages(
  plan: AponiaBootDiagnostics["routes"][number]["route"],
  global: EnhancerMetadata,
  halves: RecordedInterceptorPhases | undefined,
): readonly StageDraft[] {
  const declared = readEnhancers(plan.enhancers);
  const drafts: StageDraft[] = [];
  const interceptors: readonly ScopedEnhancer[] = Object.freeze([
    ...scopedEnhancers(global.interceptors, "global"),
    ...scopedEnhancers(declared.interceptors, "local"),
  ]);

  appendValidationStages(drafts, plan.schema);
  appendEnhancerStages(drafts, scopedEnhancers(global.guards, "global"), "guard");
  appendEnhancerStages(drafts, scopedEnhancers(declared.guards, "local"), "guard");
  appendEnhancerStages(
    drafts,
    declaringHalf(interceptors, "interceptBefore", halves),
    "interceptBefore",
  );
  appendParameterBinding(drafts, plan);

  drafts.push({ kind: "invoke", source: readRouteSource("compiled") });
  drafts.push({
    kind: "handler",
    ...(plan.propertyKey === undefined ? {} : { handler: String(plan.propertyKey) }),
  });

  appendEnhancerStages(
    drafts,
    Object.freeze([...declaringHalf(interceptors, "interceptAfter", halves)].reverse()),
    "interceptAfter",
  );

  return drafts;
}

function appendValidationStages(drafts: StageDraft[], schema: unknown): void {
  if (typeof schema !== "object" || schema === null) {
    return;
  }
  for (const slot of routeSchemaSlots) {
    if ((schema as Record<string, unknown>)[slot] === undefined) {
      continue;
    }
    const model = readModelName(schema, slot);
    drafts.push({ kind: "validate", slot, ...(model === undefined ? {} : { model }) });
  }
}

function appendEnhancerStages(
  drafts: StageDraft[],
  enhancers: readonly ScopedEnhancer[],
  kind: "guard" | "interceptBefore" | "interceptAfter",
): void {
  for (const { token, scope } of enhancers) {
    drafts.push({ kind, scope, enhancer: getTokenName(token) });
  }
}

function appendParameterBinding(
  drafts: StageDraft[],
  plan: { readonly parameters: unknown },
): void {
  const parameters = readRouteParameters(plan.parameters);
  if (parameters.length > 0) {
    drafts.push({ kind: "bind", parameters });
  }
}

function describeFilters(
  plan: { readonly enhancers: EnhancerMetadata },
  global: EnhancerMetadata,
): readonly AponiaRouteTraceFilter[] {
  const filters: AponiaRouteTraceFilter[] = [];
  for (const token of readEnhancers(plan.enhancers).filters) {
    filters.push(describeFilter(token, "local"));
  }
  for (const token of global.filters) {
    filters.push(describeFilter(token, "global"));
  }
  filters.push(Object.freeze({ kind: "default", name: problemDetailsMappingName }));
  return Object.freeze(filters);
}

function describeFilter(
  token: ClassToken<unknown>,
  scope: AponiaRouteStageScope,
): AponiaRouteTraceFilter {
  const declared: unknown = getCatchMetadata(token);
  const caught = Array.isArray(declared)
    ? declared.filter(
        (exception): exception is ClassToken<unknown> => typeof exception === "function",
      )
    : [];
  return Object.freeze({
    kind: "filter",
    name: getTokenName(token),
    scope,
    catch: Object.freeze(caught.map((exception) => getTokenName(exception))),
  });
}

function publishStages(id: string, drafts: readonly StageDraft[]): readonly AponiaRouteStage[] {
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

function readModelName(schema: unknown, slot: RouteSchemaSlot): string | undefined {
  if (typeof schema !== "object" || schema === null) {
    return undefined;
  }
  const validator = (schema as Record<string, unknown>)[slot];
  if (typeof validator !== "function") {
    return undefined;
  }
  const model = validator as ValidationModelClass;
  return getValidationMetadata(model) === undefined ? undefined : getTokenName(model);
}

function scopedEnhancers(
  tokens: readonly ClassToken<unknown>[],
  scope: AponiaRouteStageScope,
): readonly ScopedEnhancer[] {
  return tokens.map((token) => Object.freeze({ token, scope }));
}

function declaringHalf(
  enhancers: readonly ScopedEnhancer[],
  half: InterceptorHalf,
  recorded: RecordedInterceptorPhases | undefined,
): readonly ScopedEnhancer[] {
  return Object.freeze(enhancers.filter(({ token }) => declaresHalf(token, half, recorded)));
}

function declaresHalf(
  token: ClassToken<unknown>,
  half: InterceptorHalf,
  recorded: RecordedInterceptorPhases | undefined,
): boolean {
  const entry = recorded?.get(token);
  if (entry !== undefined) {
    return half === "interceptBefore" ? entry.before : entry.after;
  }
  const members = (token as { readonly prototype?: unknown }).prototype;
  return (
    typeof members === "object" &&
    members !== null &&
    typeof (members as Record<string, unknown>)[half] === "function"
  );
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function compareOrderedRoutes(left: OrderedRoute, right: OrderedRoute): number {
  return compareText(left.path, right.path) || compareText(left.method, right.method);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Kept for the stage kind union's consumers; a contributed hook is not published. */
export type { AponiaRouteStageKind };
