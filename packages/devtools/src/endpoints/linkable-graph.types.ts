/**
 * The supported entity types for visual graph nodes.
 */
export type DevtoolsGraphNodeType = "module" | "controller" | "provider" | "route" | "gateway";

/**
 * A linkable node representing a framework entity in the visual graph.
 */
export interface DevtoolsGraphNode {
  readonly id: string;
  readonly type: DevtoolsGraphNodeType;
  readonly name: string;
  readonly moduleId?: string;
  readonly controllerId?: string;
  readonly metadata?: {
    readonly isRoot?: boolean;
    readonly instanceId?: string;
    readonly scope?: "singleton" | "request" | "transient";
    readonly kind?: string;
    readonly isExported?: boolean;
    readonly routeMethod?: string;
    readonly routePath?: string;
  };
  readonly source?: {
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
  };
}

/**
 * The relationship type connecting two graph nodes.
 */
export type DevtoolsGraphEdgeType =
  | "MODULE_IMPORTS"
  | "MODULE_EXPORTS"
  | "MODULE_DECLARES"
  | "INJECTS"
  | "MOUNTS_ROUTE";

/**
 * A directed edge connecting two entities in the visual graph.
 */
export interface DevtoolsGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly type: DevtoolsGraphEdgeType;
  readonly paramIndex?: number;
}

/**
 * Structural diagnostics detected across the dependency graph.
 */
export interface DevtoolsGraphDiagnostics {
  readonly unusedProviders: readonly string[];
  readonly circularDependencies: readonly string[];
}

/**
 * Complete linkable graph payload for visual renderers and MCP inspection.
 */
export interface LinkableGraphPayload {
  readonly nodes: readonly DevtoolsGraphNode[];
  readonly edges: readonly DevtoolsGraphEdge[];
  readonly diagnostics: DevtoolsGraphDiagnostics;
}
