# Aponia DevTools & Embedded MCP Integration — Design Specification

## Overview

This specification defines the architecture and integration model for `@aponiajs/devtools` to power external developer dashboards and AI coding assistants (such as Cursor and Claude Code) via Model Context Protocol (MCP).

### Goals

1. **Linkable Graph & Traceability (Nodes & Edges)**: Deliver an interconnected, directed graph model across Modules, Controllers, Providers, Routes, and Enhancers, ready for node-link visualizers (e.g., React Flow, Cytoscape, D3.js).
2. **Code Provenance & Source Inspection**: Provide exact source code locations (`filePath`, `line`, `column`) and on-demand code retrieval for any component or handler.
3. **Elysia Store & Context Snapshots**: Capture state snapshots and transformations across request lifecycle stages, exposing Elysia's native `store`, `@State()`, and `RequestContextService` values.
4. **Embedded Professional MCP Server**: Mount an in-process MCP server at `/__devtools/mcp` (SSE / JSON-RPC), exposing 6 standardized tools for AI agents.

---

## 1. Unified Linkable Graph Model (`inspect_application_graph`)

### Node Definitions

Every framework entity is assigned a canonical identifier and metadata:

- **Module**: `module:<ModuleName>` (e.g., `module:AppModule`, `module:UsersModule`)
- **Controller**: `controller:<ControllerName>` (e.g., `controller:UsersController`)
- **Provider**: `provider:<TokenName>` (e.g., `provider:UsersService`, `provider:DATABASE_CONNECTION`)
- **Route**: `route:<METHOD>:<Path>` (e.g., `route:GET:/users/:id`)
- **Gateway**: `gateway:<Path>` (e.g., `gateway:/chat`)
- **Enhancer**: `<kind>:<Name>` (e.g., `guard:AuthGuard`, `middleware:LoggerMiddleware`, `pipe:ParseIntPipe`, `filter:HttpExceptionFilter`)

### Edge Definitions

Directed relationships connecting nodes:

- `MODULE_IMPORTS`: Source module imports target module.
- `MODULE_EXPORTS`: Source module exports provider token.
- `MODULE_DECLARES`: Module declares controller or provider.
- `INJECTS`: Controller or Provider injects target Provider (annotated with constructor parameter index).
- `MOUNTS_ROUTE`: Controller owns HTTP route.
- `APPLIES_ENHANCER`: Route or Controller is guarded/piped/intercepted by Enhancer.

### Payload Wire Shape

```ts
export interface DevtoolsGraphNode {
  readonly id: string;
  readonly type: "module" | "controller" | "provider" | "route" | "gateway" | "enhancer";
  readonly name: string;
  readonly moduleId?: string;
  readonly controllerId?: string;
  readonly metadata: {
    readonly scope?: "singleton" | "request" | "transient";
    readonly kind?: "class" | "value" | "factory" | "alias";
    readonly isExported?: boolean;
    readonly isGlobal?: boolean;
    readonly isUnused?: boolean;
    readonly routeMethod?: string;
    readonly routePath?: string;
  };
  readonly source?: {
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
  };
}

export interface DevtoolsGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly type:
    | "MODULE_IMPORTS"
    | "MODULE_EXPORTS"
    | "MODULE_DECLARES"
    | "INJECTS"
    | "MOUNTS_ROUTE"
    | "APPLIES_ENHANCER";
  readonly paramIndex?: number;
}

export interface DevtoolsGraphPayload {
  readonly nodes: readonly DevtoolsGraphNode[];
  readonly edges: readonly DevtoolsGraphEdge[];
  readonly diagnostics: {
    readonly unusedProviders: readonly string[];
    readonly circularDependencies: readonly string[];
  };
}
```

---

## 2. Route Pipeline & State Inspection (`inspect_route_pipeline`, `inspect_store_state`)

### Lifecycle Execution Chain

Reflects the actual runtime execution order in Aponia:
$$\text{Request} \longrightarrow \text{Middleware} \longrightarrow \text{Guards} \longrightarrow \text{Interceptors (Before)} \longrightarrow \text{Pipes} \longrightarrow \text{Handler} \longrightarrow \text{Interceptors (After)} \longrightarrow \text{Filters} \longrightarrow \text{Response}$$

### Pipeline Stage Details

```ts
export interface PipelineStageDescriptor {
  readonly step: number;
  readonly stage:
    | "middleware"
    | "guard"
    | "interceptor:before"
    | "pipe"
    | "handler"
    | "interceptor:after"
    | "filter";
  readonly targetId: string;
  readonly name: string;
  readonly source?: {
    readonly filePath: string;
    readonly line: number;
  };
  readonly parameterBinding?: {
    readonly index: number;
    readonly name?: string;
    readonly kind: string;
  };
}

export interface RoutePipelinePayload {
  readonly routeId: string;
  readonly method: string;
  readonly path: string;
  readonly controllerId: string;
  readonly handlerMethod: string;
  readonly source?: {
    readonly filePath: string;
    readonly line: number;
  };
  readonly schemas: {
    readonly body?: boolean;
    readonly query?: boolean;
    readonly params?: boolean;
    readonly headers?: boolean;
  };
  readonly stages: readonly PipelineStageDescriptor[];
}
```

### Store & Context State Snapshots

Captured per stage and reported in recent request traces:

- `globalStore`: Sanitized shallow snapshot of Elysia `app.state()` / `context.store`.
- `derivedState`: Object accumulated through Elysia `.derive()` plugins and `@State()`.
- `pipeTransformations`: `before` vs `after` parameter value diffs.
- `alsContext`: Token values in `RequestContextService`.

---

## 3. Source Code Inspection (`get_source_code`)

Allows on-demand reading of component implementations directly from the running project source:

### Target Resolution

1. Target identifiers can be:
   - Class name: `"UsersService"`, `"AuthGuard"`, `"UsersController"`
   - Method name: `"UsersController.findOne"`
   - File path with line: `"src/users/users.service.ts:15"`
2. Uses cached project AST analysis from `@aponiajs/cli` without blocking startup.

### Output Contract

```ts
export interface SourceCodeResult {
  readonly target: string;
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly code: string;
}
```

---

## 4. Professional MCP Tools Specification

The MCP Server is served at `/__devtools/mcp` using standard SSE transport for events and POST for JSON-RPC 2.0 messages.

### Tool Registry

#### 1. `get_source_code`

- **Description**: "Retrieve the source code implementation of a controller, service, handler method, or enhancer in the running application."
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "target": {
        "type": "string",
        "description": "Class name, Handler method (e.g. UsersController.findOne), or file path."
      },
      "includeContext": {
        "type": "boolean",
        "description": "Include surrounding class decorators and imports."
      }
    },
    "required": ["target"]
  }
  ```

#### 2. `inspect_application_graph`

- **Description**: "Inspect the complete Dependency Injection graph of the application, including modules, controllers, providers, scopes, and directed dependencies."
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "module": {
        "type": "string",
        "description": "Optional module filter to inspect a specific subgraph."
      }
    }
  }
  ```

#### 3. `inspect_route_pipeline`

- **Description**: "Inspect the execution pipeline of a route, showing exact execution order from middleware, guards, interceptors, pipes, handler, to exception filters."
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "method": { "type": "string", "description": "HTTP method (GET, POST, etc.)" },
      "path": { "type": "string", "description": "Route path pattern (e.g. /users/:id)" }
    },
    "required": ["method", "path"]
  }
  ```

#### 4. `inspect_store_state`

- **Description**: "Inspect current in-memory snapshots of the global Elysia store and request context state."
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "key": { "type": "string", "description": "Optional store key to inspect." }
    }
  }
  ```

#### 5. `query_recent_requests`

- **Description**: "Query recent HTTP requests processed by the application, including status, duration, errors, and state snapshots."
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "status": { "type": "number", "description": "Filter by HTTP status code." },
      "limit": {
        "type": "number",
        "description": "Maximum number of records to return (default 20)."
      },
      "onlyErrors": { "type": "boolean", "description": "Filter only failing (4xx, 5xx) requests." }
    }
  }
  ```

#### 6. `read_application_logs`

- **Description**: "Read recent application logs emitted through the LoggerService."
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "level": {
        "type": "string",
        "enum": ["error", "warn", "info", "debug"],
        "description": "Filter by minimum log level."
      },
      "since": { "type": "number", "description": "Cursor offset to read logs since." }
    }
  }
  ```

---

## 5. Security & Dev Mode Invariants

1. **Explicit Enablement**: Devtools & MCP are only active when `DevtoolsOptions.enabled: true`. In production (`NODE_ENV === "production"`), the plugin returns `undefined` and mounts zero routes.
2. **Read-Only Inspection**: All MCP tools and HTTP endpoints perform read-only reflection and state inspection; no arbitrary code execution or state corruption can occur.
3. **Sensitive Data Redaction**: Headers and fields matching `capture.redact` (e.g. `authorization`, cookies, secret tokens) are redacted in request and state traces.
