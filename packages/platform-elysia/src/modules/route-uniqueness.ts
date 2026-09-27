import { AponiaError, tokenName, type ModuleDefinition, type Token } from "@aponiajs/common";
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
 * Rejects a route declaration that another declaration already owns.
 *
 * Elysia resolves a repeated `(method, path)` by whichever registration wins
 * under its composition policy, so the answering handler changes with
 * `elysia.aot`. An application must never learn its routing from a compiler
 * flag, so the ambiguity fails while the module graph is lowered.
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
      const controllerName = tokenName(token);
      for (const route of routes) {
        const claim: RouteClaim = {
          module,
          token,
          controller: controllerName,
          propertyKey: route.propertyKey,
        };
        const key = `${route.method} ${route.path}`;
        const existing = claims.get(key);
        if (!existing) {
          claims.set(key, claim);
          continue;
        }
        if (isSameDeclaration(existing, claim)) {
          continue;
        }

        throw duplicateRoute(existing, claim, route);
      }
    }
  }
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

    for (const imported of module.imports) {
      visit(imported);
    }
    modules.push(module);
  };

  visit(root);
  return modules;
}
