import {
  AponiaError,
  getTokenName,
  resolveForwardRef,
  type ModuleDefinition,
  type Token,
} from "@aponiajs/common";
import { isElysiaController } from "../controllers/controller-definition.ts";
import type { CompiledElysiaRoute } from "../routing/route-compiler.types.ts";

/**
 * One registration of one route: the controller method that answers it, and the
 * module that mounted it.
 */
interface RouteClaim {
  readonly module: ModuleDefinition;
  readonly token: Token<unknown>;
  readonly controller: string;
  readonly propertyKey: string | symbol;
}

/**
 * One route the compiled graph claims, by the names of its claimants.
 *
 * This is the read-only projection of a claim, for the caller outside this file
 * that has to refuse a route of its own — bootstrap's health probes mount
 * outside the compiled graph and therefore outside the check below. The token
 * stays out of it for the reason the check itself is not a token comparison:
 * a name is what an error can state.
 *
 * @internal
 */
export interface ClaimedElysiaRoute {
  readonly module: string;
  readonly controller: string;
  readonly propertyKey: string;
}

/**
 * Rejects a route declaration that another declaration already owns.
 *
 * Elysia resolves a repeated `(method, path)` by whichever registration wins,
 * so the answering handler would depend on mount order. An application must
 * never learn its routing from a mounting detail, so the ambiguity fails while
 * the module graph is lowered.
 *
 * Only the modules reachable from the compiled root through `imports` are
 * considered, which is exactly the set bootstrap mounts: `compileModuleGraph`
 * walks the same edges and identifies modules by `instanceId ?? id`, raising
 * `DUPLICATE_MODULE` before two definitions can share one identity. Reading the
 * module compiler's own working maps instead would also inspect definitions the
 * root never reaches.
 *
 * A compiled controller registers once per module that declares it, and a
 * dynamic module merged onto a decorated class legitimately names one
 * controller from two reachable modules. Those registrations repeat one
 * controller method, so they describe one route rather than two claims on it.
 * A repeated `(method, path)` from anywhere else is a collision.
 *
 * Routes a native plugin provides are deliberately outside this check: plugins
 * mount through `use()`, and a controller overriding one is Elysia's documented
 * behavior rather than a collision Aponia can see while lowering.
 *
 * @internal
 */
export function assertUniqueElysiaRoutes(root: ModuleDefinition): void {
  const claims = new Map<string, RouteClaim>();

  for (const registration of routeRegistrations(root)) {
    const existing = claims.get(registration.key);
    if (!existing) {
      claims.set(registration.key, registration.claim);
      continue;
    }
    if (isSameDeclaration(existing, registration.claim)) {
      continue;
    }

    throw duplicateRoute(existing, registration.claim, registration.route);
  }
}

/**
 * Every route the compiled graph claims, keyed `"METHOD path"`.
 *
 * The walk is the check's own, exposed so a mount that happens outside the
 * compiled graph can ask the same question the check asks. Bootstrap's health
 * probes are the caller: they are platform routes rather than controller routes,
 * so nothing about them reaches this file's check, and a probe path a controller
 * already answers has to be refused where the probe exists.
 *
 * A repeat within the graph is not visible here, because a map keyed by the
 * route keeps one entry per route — the first declaration in graph order. A
 * repeat is the check above's business, and it reads the walk this function
 * reads rather than restating one of its own.
 *
 * The entries are frozen and the map is new: this is a result a caller outside
 * this module holds, and the walk it came from is a working collection.
 *
 * @internal
 */
export function collectClaimedElysiaRoutes(
  root: ModuleDefinition,
): ReadonlyMap<string, ClaimedElysiaRoute> {
  const projected = new Map<string, ClaimedElysiaRoute>();

  for (const registration of routeRegistrations(root)) {
    if (projected.has(registration.key)) {
      continue;
    }

    const claim = registration.claim;
    projected.set(
      registration.key,
      Object.freeze({
        module: claim.module.id,
        controller: claim.controller,
        propertyKey: String(claim.propertyKey),
      }),
    );
  }

  return projected;
}

/**
 * One registration, as the walk reaches it.
 */
interface RouteRegistration {
  readonly key: string;
  readonly route: CompiledElysiaRoute;
  readonly claim: RouteClaim;
}

/**
 * The walk both functions above read from: every registration in graph order,
 * including a route two declarations reach, because the check above has to see
 * the repeat that the projection deliberately collapses.
 */
function routeRegistrations(root: ModuleDefinition): readonly RouteRegistration[] {
  const registrations: RouteRegistration[] = [];

  for (const module of reachableModules(root)) {
    for (const controller of module.controllers) {
      if (!isElysiaController(controller)) {
        continue;
      }
      const routes = controller.compiledRoutes;
      if (!routes) {
        continue;
      }

      const token = controller.token;
      const controllerName = getTokenName(token);
      for (const route of routes) {
        registrations.push({
          key: `${route.method} ${route.path}`,
          route,
          claim: {
            module,
            token,
            controller: controllerName,
            propertyKey: route.propertyKey,
          },
        });
      }
    }
  }

  return registrations;
}

/**
 * Every module declaring one controller class compiles its own route plan, so
 * the plans' declarations, not the plan objects, are the identity that tells a
 * repeated mount apart from a second claim on the same route.
 */
function isSameDeclaration(left: RouteClaim, right: RouteClaim): boolean {
  return left.token === right.token && left.propertyKey === right.propertyKey;
}

function duplicateRoute(
  existing: RouteClaim,
  claimed: RouteClaim,
  route: CompiledElysiaRoute,
): AponiaError {
  return new AponiaError(
    "DUPLICATE_ROUTE",
    `Route "${route.method} ${route.path}" is claimed by more than one controller.`,
    {
      method: route.method,
      path: route.path,
      modules: Object.freeze([existing.module.id, claimed.module.id]),
      controllers: Object.freeze([existing.controller, claimed.controller]),
      handlers: Object.freeze([String(existing.propertyKey), String(claimed.propertyKey)]),
    },
  );
}

/**
 * Post-order walk over the compiled `imports` edges. The order matches
 * `ModuleGraph.modules`, so the recorded claim is the registration bootstrap
 * reaches first.
 */
function reachableModules(root: ModuleDefinition): readonly ModuleDefinition[] {
  const modules: ModuleDefinition[] = [];
  const visited = new Set<ModuleDefinition>();

  const visit = (module: ModuleDefinition): void => {
    if (visited.has(module)) {
      return;
    }
    visited.add(module);

    for (const rawImport of module.imports) {
      const imported = resolveForwardRef(rawImport);
      if (imported) {
        visit(imported);
      }
    }
    modules.push(module);
  };

  visit(root);
  return modules;
}
