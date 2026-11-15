import {
  compileRootModule,
  inspectAponiaApplication,
  type AponiaApplicationDiagnostics,
} from "@aponiajs/platform-elysia";
import { buildLinkableGraph } from "./linkable-graph.ts";
import type { AponiaGraphPayload } from "./payloads.types.ts";

/** The path this endpoint is served under, relative to the devtools prefix. */
export const devtoolsGraphPath = "/graph";

/**
 * Options configuring the graph payload projection.
 */
export interface BuildGraphOptions {
  readonly view?: string;
}

/**
 * Builds the payload `/graph` answers with, once per boot, or `undefined` when
 * the boot record holds no graph this release can describe.
 *
 * The graph is the one the boot compiled, never the decorated classes the
 * application named. The record's `rootModule` is the root `compileRootModule`
 * already returned, so lowering it again answers that same descriptor, and the
 * projection is `inspectAponiaApplication` — the same function `bun run inspect`
 * uses. The two therefore cannot disagree: the projection resolves its root
 * through the selector, which substitutes only a class or a dynamic module, so a
 * descriptor handed to it is the graph itself.
 *
 * When `view` is `"graph"` or `"nodes"`, the payload also carries linkable
 * `nodes` and `edges` for visual graph engines and MCP clients.
 */
export function buildGraphPayload(
  diagnostics: AponiaApplicationDiagnostics | undefined,
  options?: BuildGraphOptions,
): AponiaGraphPayload | undefined {
  const rootModule = diagnostics?.rootModule;

  if (rootModule === undefined) {
    return undefined;
  }

  try {
    const inspection = inspectAponiaApplication(compileRootModule(rootModule));

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
  } catch {
    // A record a foreign copy wrote compiles as a foreign graph, and the boot
    // this endpoint reports on already compiled its own: a failure here can only
    // mean the record is not this release's to project.
    return undefined;
  }
}
