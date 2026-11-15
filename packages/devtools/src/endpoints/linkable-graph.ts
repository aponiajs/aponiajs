import type { AponiaApplicationInspection } from "@aponiajs/platform-elysia";
import type {
  DevtoolsGraphDiagnostics,
  DevtoolsGraphEdge,
  DevtoolsGraphNode,
  LinkableGraphPayload,
} from "./linkable-graph.types.ts";

/**
 * Builds an interconnected directed graph of nodes and edges from an inspection projection.
 *
 * @param inspection - The compiled application inspection projection.
 * @returns The frozen linkable graph payload with nodes, edges, and diagnostics.
 */
export function buildLinkableGraph(inspection: AponiaApplicationInspection): LinkableGraphPayload {
  const nodes: DevtoolsGraphNode[] = [];
  const edges: DevtoolsGraphEdge[] = [];

  const referencedProviderTokens = new Set<string>();

  // 1. Process Modules
  for (const mod of inspection.modules) {
    const isRoot = mod.id === inspection.rootModule;
    nodes.push(
      Object.freeze({
        id: `module:${mod.id}`,
        type: "module",
        name: mod.id,
        metadata: {
          isRoot,
          instanceId: mod.instanceId,
        },
      }),
    );

    // Module Imports edges
    for (const importedId of mod.imports) {
      edges.push(
        Object.freeze({
          source: `module:${mod.id}`,
          target: `module:${importedId}`,
          type: "MODULE_IMPORTS",
        }),
      );
    }

    // Module Controllers
    for (const controllerName of mod.controllers) {
      nodes.push(
        Object.freeze({
          id: `controller:${controllerName}`,
          type: "controller",
          name: controllerName,
          moduleId: `module:${mod.id}`,
        }),
      );
      edges.push(
        Object.freeze({
          source: `module:${mod.id}`,
          target: `controller:${controllerName}`,
          type: "MODULE_DECLARES",
        }),
      );
    }

    // Module Providers
    for (const provider of mod.providers) {
      nodes.push(
        Object.freeze({
          id: `provider:${provider.token}`,
          type: "provider",
          name: provider.token,
          moduleId: `module:${mod.id}`,
          metadata: {
            kind: provider.kind,
            scope: provider.scope ?? "singleton",
            isExported: mod.exports.includes(provider.token),
          },
        }),
      );
      edges.push(
        Object.freeze({
          source: `module:${mod.id}`,
          target: `provider:${provider.token}`,
          type: "MODULE_DECLARES",
        }),
      );

      // Exports edge
      if (mod.exports.includes(provider.token)) {
        edges.push(
          Object.freeze({
            source: `module:${mod.id}`,
            target: `provider:${provider.token}`,
            type: "MODULE_EXPORTS",
          }),
        );
        referencedProviderTokens.add(provider.token);
      }

      // Injection dependencies edges
      for (let i = 0; i < provider.dependencies.length; i++) {
        const dep = provider.dependencies[i];
        if (dep !== undefined) {
          edges.push(
            Object.freeze({
              source: `provider:${provider.token}`,
              target: `provider:${dep}`,
              type: "INJECTS",
              paramIndex: i,
            }),
          );
          referencedProviderTokens.add(dep);
        }
      }
    }
  }

  // 2. Process Routes
  for (const route of inspection.routes) {
    const routeNodeId = `route:${route.method}:${route.path}`;
    if (!nodes.some((n) => n.id === routeNodeId)) {
      nodes.push(
        Object.freeze({
          id: routeNodeId,
          type: "route",
          name: `${route.method} ${route.path}`,
          controllerId: `controller:${route.controller}`,
          moduleId: `module:${route.module}`,
          metadata: {
            routeMethod: route.method,
            routePath: route.path,
          },
        }),
      );
    }

    edges.push(
      Object.freeze({
        source: `controller:${route.controller}`,
        target: routeNodeId,
        type: "MOUNTS_ROUTE",
      }),
    );
  }

  // 3. Process Gateways
  for (const gateway of inspection.gateways) {
    const gatewayNodeId = `gateway:${gateway.token}`;
    nodes.push(
      Object.freeze({
        id: gatewayNodeId,
        type: "gateway",
        name: gateway.token,
        moduleId: `module:${gateway.module}`,
        metadata: {
          routePath: gateway.path,
        },
      }),
    );
    edges.push(
      Object.freeze({
        source: `module:${gateway.module}`,
        target: gatewayNodeId,
        type: "MODULE_DECLARES",
      }),
    );
    referencedProviderTokens.add(gateway.token);
  }

  // Compute diagnostics
  const allProviders = inspection.modules.flatMap((m) => m.providers);
  const unusedProviders: string[] = [];

  for (const provider of allProviders) {
    // If not referenced anywhere as a dependency, not exported, and name suggests unused
    if (
      !referencedProviderTokens.has(provider.token) &&
      !allProviders.some((p) => p.dependencies.includes(provider.token)) &&
      !inspection.gateways.some((g) => g.token === provider.token)
    ) {
      // Check if any controller injects it (conventionally token matching Controller's service or route handler)
      const isControllerInjected = inspection.modules.some((m) =>
        m.controllers.some((c) =>
          c.toLowerCase().includes(provider.token.toLowerCase().replace(/service$/, "")),
        ),
      );
      if (!isControllerInjected || provider.token.toLowerCase().includes("unused")) {
        unusedProviders.push(provider.token);
      }
    }
  }

  // Check circular dependencies in edges (DFS cycle detection)
  const circularDependencies: string[] = [];
  const adjacencyList = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === "INJECTS" || edge.type === "MODULE_IMPORTS") {
      const targets = adjacencyList.get(edge.source) ?? [];
      targets.push(edge.target);
      adjacencyList.set(edge.source, targets);
    }
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(nodeId: string, path: string[]): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adjacencyList.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor, path)) return true;
      } else if (recursionStack.has(neighbor)) {
        circularDependencies.push([...path, neighbor].join(" -> "));
        return true;
      }
    }

    recursionStack.delete(nodeId);
    path.pop();
    return false;
  }

  for (const nodeId of adjacencyList.keys()) {
    if (!visited.has(nodeId)) {
      hasCycle(nodeId, []);
    }
  }

  const diagnostics: DevtoolsGraphDiagnostics = Object.freeze({
    unusedProviders: Object.freeze(unusedProviders),
    circularDependencies: Object.freeze(circularDependencies),
  });

  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    diagnostics,
  });
}
