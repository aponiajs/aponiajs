import type { AponiaBootDiagnostics } from "@aponiajs/common";
import { inspectBootDiagnostics } from "./inspection.ts";
import { buildLinkableGraph } from "./linkable-graph.ts";
import type { AponiaGraphPayload } from "../interfaces/payloads.interface.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsGraphPath = "/graph";

/** Options configuring the graph payload projection. */
export interface BuildGraphOptions {
  readonly view?: string;
}

/**
 * Builds the payload `/graph` answers with, once per boot, or `undefined` when
 * the record holds no compiled root.
 *
 * The graph is projected from the neutral boot record the platform published —
 * modules, providers, controllers, routes, and gateways — so the same projection
 * describes every platform. Nothing is recompiled and no instance is built.
 *
 * When `view` is `"graph"` or `"nodes"`, the payload also carries linkable
 * `nodes` and `edges` for visual graph engines and MCP clients.
 */
export function buildGraphPayload(
  diagnostics: AponiaBootDiagnostics | undefined,
  options?: BuildGraphOptions,
): AponiaGraphPayload | undefined {
  const inspection = inspectBootDiagnostics(diagnostics);
  if (inspection === undefined) {
    return undefined;
  }

  if (options?.view === "graph" || options?.view === "nodes") {
    const linkable = buildLinkableGraph(inspection);
    return Object.freeze({
      rootModule: inspection.rootModule,
      modules: inspection.modules,
      gateways: inspection.gateways,
      nodes: linkable.nodes,
      edges: linkable.edges,
      diagnostics: linkable.diagnostics,
    });
  }

  return Object.freeze({
    rootModule: inspection.rootModule,
    modules: inspection.modules,
    gateways: inspection.gateways,
  });
}
