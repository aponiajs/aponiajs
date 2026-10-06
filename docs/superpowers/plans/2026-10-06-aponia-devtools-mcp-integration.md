# Aponia DevTools & Embedded MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement linkable DI graph nodes & edges, request lifecycle state snapshots, and an embedded Model Context Protocol (MCP) server in `@aponiajs/devtools`.

**Architecture:** Extend `@aponiajs/platform-elysia`'s inspection and request diagnostic structures with directed edge metadata and state snapshots. In `@aponiajs/devtools`, build enhanced `/graph` and `/flow` payload builders, add a source-code extraction utility via project AST, and mount an embedded MCP server at `/__devtools/mcp` supporting 6 standard tools (`get_source_code`, `inspect_application_graph`, `inspect_route_pipeline`, `inspect_store_state`, `query_recent_requests`, `read_application_logs`).

**Tech Stack:** TypeScript, Bun, Elysia, `@modelcontextprotocol/sdk` (or pure lightweight JSON-RPC/SSE over native Elysia), `ts-morph` AST extraction.

**Spec:** `docs/superpowers/specs/2026-10-06-aponia-devtools-mcp-integration-design.md`

## Global Constraints

- Strict TypeScript, ESM, explicit `.ts` extensions in local imports.
- DevTools must remain completely inert when `DevtoolsOptions.enabled` is false.
- Zero extra dependencies in production bundle (`@aponiajs/devtools` is an opt-in leaf package).
- Maintain ≥ 95% line and function test coverage floor across workspaces.
- All repository content and comments must be in English.

## Review Focus

1. `/__devtools/graph` must correctly calculate provider-to-provider dependencies and parameter injection indices without missing custom tokens.
2. `get_source_code` must handle both class-level targets (e.g. `UsersService`) and method-level targets (e.g. `UsersController.findOne`) gracefully, returning exact line ranges.
3. Elysia `store` and `@State()` snapshots in `request-capture.ts` must never crash on uncloneable/unserializable circular references (e.g., using safe serialization).
4. MCP SSE connections at `/__devtools/mcp` must properly isolate events between concurrent clients and clean up listeners on client disconnect.
5. All endpoints must preserve `GET` idempotence and return `405` for unsupported HTTP methods on non-MCP endpoints.

---

### Task 1: Linkable Graph Model & Code Provenance in `@aponiajs/platform-elysia`

**Files:**

- Modify: `packages/platform-elysia/src/inspection/application-inspection.types.ts`
- Modify: `packages/platform-elysia/src/inspection/application-inspection.ts`
- Test: `packages/platform-elysia/tests/inspection.test.ts`

**Interfaces:**

- Produces: `AponiaGraphNode`, `AponiaGraphEdge`, and enhanced `AponiaApplicationInspection` containing `nodes` and `edges`.

- [ ] **Step 1: Write the failing test for linkable graph nodes and edges**
      Add a test in `packages/platform-elysia/tests/inspection.test.ts` asserting that `inspectAponiaApplication` produces a directed graph with `nodes` and `edges` (including `MODULE_IMPORTS`, `MODULE_DECLARES`, and `INJECTS`).

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test packages/platform-elysia/tests/inspection.test.ts`
      Expected: FAIL with missing properties `nodes` and `edges`.

- [ ] **Step 3: Implement nodes and edges generation in `application-inspection.ts`**
      Enrich `inspectAponiaApplication` to generate nodes for every module, controller, provider, and route, and create edges for `MODULE_IMPORTS`, `MODULE_DECLARES`, `INJECTS` (with parameter index), and `MOUNTS_ROUTE`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test packages/platform-elysia/tests/inspection.test.ts`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-elysia/src/inspection/ packages/platform-elysia/tests/inspection.test.ts
git commit -m "feat(platform-elysia): add linkable nodes and edges to application inspection"
```

---

### Task 2: Enhanced `/__devtools/graph` Endpoint with Diagnostics

**Files:**

- Modify: `packages/devtools/src/endpoints/graph.ts`
- Modify: `packages/devtools/src/endpoints/payloads.types.ts`
- Test: `packages/devtools/tests/graph.test.ts`

**Interfaces:**

- Consumes: `nodes` and `edges` from `AponiaApplicationInspection`.
- Produces: `AponiaGraphPayload` with `nodes`, `edges`, and `diagnostics` (`unusedProviders`, `circularDependencies`).

- [ ] **Step 1: Write the failing test for `/__devtools/graph`**
      Test that `buildGraphPayload` returns the unified graph payload with `nodes`, `edges`, and calculated `unusedProviders`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test packages/devtools/tests/graph.test.ts`
      Expected: FAIL.

- [ ] **Step 3: Implement enhanced graph payload builder**
      Update `packages/devtools/src/endpoints/graph.ts` to compute unused providers and format `nodes` and `edges`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test packages/devtools/tests/graph.test.ts`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/devtools/src/endpoints/graph.ts packages/devtools/src/endpoints/payloads.types.ts packages/devtools/tests/graph.test.ts
git commit -m "feat(devtools): enhance /graph endpoint with linkable nodes, edges, and diagnostics"
```

---

### Task 3: Lifecycle State & Store Snapshots in Request Capture

**Files:**

- Modify: `packages/devtools/src/requests/request-buffer.types.ts`
- Modify: `packages/devtools/src/requests/request-capture.ts`
- Test: `packages/devtools/tests/requests.test.ts`

**Interfaces:**

- Produces: `RequestRecord.storeSnapshot`, `RequestRecord.stateSnapshot`, and `RequestRecord.trace`.

- [ ] **Step 1: Write failing test in `packages/devtools/tests/requests.test.ts`**
      Assert that captured requests include safe shallow snapshots of Elysia `store` and request `state`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test packages/devtools/tests/requests.test.ts`
      Expected: FAIL.

- [ ] **Step 3: Implement store and state capture in `request-capture.ts`**
      Extract `context.store` and `context.state` safely (handling circular references via shallow copies or safe serialization) during request arrival and completion.

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test packages/devtools/tests/requests.test.ts`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/devtools/src/requests/ packages/devtools/tests/requests.test.ts
git commit -m "feat(devtools): capture store and state snapshots in request records"
```

---

### Task 4: Source Code Resolver Engine (`get_source_code`)

**Files:**

- Create: `packages/devtools/src/source/source-resolver.ts`
- Create: `packages/devtools/src/source/source-resolver.types.ts`
- Test: `packages/devtools/tests/source-resolver.test.ts`

**Interfaces:**

- Produces: `resolveSourceCode(target: string, options?: { includeContext?: boolean }): Promise<SourceCodeResult | undefined>`

- [ ] **Step 1: Write failing test for source code resolution**
      Test finding source code for a class token (e.g. `AppService`) and a method (e.g. `AppController.getHello`), returning `{ filePath, lineStart, lineEnd, code }`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test packages/devtools/tests/source-resolver.test.ts`
      Expected: FAIL.

- [ ] **Step 3: Implement `source-resolver.ts` using ts-morph AST analysis**
      Implement AST lookup locating class declarations, method declarations, and extracting line numbers and clean code content.

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test packages/devtools/tests/source-resolver.test.ts`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/devtools/src/source/ packages/devtools/tests/source-resolver.test.ts
git commit -m "feat(devtools): add source code resolution engine for classes and methods"
```

---

### Task 5: Embedded Model Context Protocol (MCP) Server

**Files:**

- Create: `packages/devtools/src/mcp/mcp-server.ts`
- Create: `packages/devtools/src/mcp/mcp-server.types.ts`
- Create: `packages/devtools/src/mcp/mcp-tools.ts`
- Modify: `packages/devtools/src/server/devtools-handlers.ts`
- Modify: `packages/devtools/src/server/devtools-dispatcher.ts`
- Test: `packages/devtools/tests/mcp-server.test.ts`

**Interfaces:**

- Produces: MCP endpoint at `/__devtools/mcp` serving SSE + JSON-RPC 2.0 with the 6 professional tools:
  - `get_source_code`
  - `inspect_application_graph`
  - `inspect_route_pipeline`
  - `inspect_store_state`
  - `query_recent_requests`
  - `read_application_logs`

- [ ] **Step 1: Write failing test for MCP endpoint**
      Test sending JSON-RPC `tools/list` and `tools/call` requests to `/__devtools/mcp` and receiving properly formatted tool results.

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test packages/devtools/tests/mcp-server.test.ts`
      Expected: FAIL.

- [ ] **Step 3: Implement MCP JSON-RPC protocol and tool handlers**
      Create the lightweight protocol handler in `packages/devtools/src/mcp/`, wire tool execution to the existing endpoints and source resolver, and mount at `/__devtools/mcp`.

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test packages/devtools/tests/mcp-server.test.ts`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/devtools/src/mcp/ packages/devtools/src/server/ packages/devtools/tests/mcp-server.test.ts
git commit -m "feat(devtools): add embedded MCP server with standard professional toolset"
```

---

### Task 6: Full Verification, Documentation, and Workspace Release

**Files:**

- Modify: `docs/devtools.md`
- Modify: `packages/devtools/README.md`
- Modify: `packages/devtools/llms.txt`

- [ ] **Step 1: Update documentation for DevTools MCP and linkable models**
      Document `/__devtools/mcp`, setup instructions for Cursor/Claude, and new `/graph` payload contracts in `docs/devtools.md` and package guides.

- [ ] **Step 2: Run complete repository verification gates**
      Run `bun run check`, `bun test`, `bun run test:coverage`, and `bun run test:vite-plus`. Ensure all 100% pass and coverage meets ≥ 95%.

- [ ] **Step 3: Bump workspace version and sync release references**
      Run `bun run version:beta` to increment to `1.0.0-beta.20` and synchronize manifests.

- [ ] **Step 4: Commit and push**

```bash
git add .
git commit -m "docs(devtools): document embedded MCP server and linkable graph models"
git push origin tanya
```
