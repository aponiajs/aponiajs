# WebSocket Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance AponiaJS WebSocket gateways with production-grade per-message schema validation (Standard Schema & TypeBox), HTTP handshake upgrade guards, and configurable message payload size limits.

**Architecture:**

1. `@aponiajs/common`: Extend `@SubscribeMessage(event, schema?)` and `@WebSocketGateway(options)` metadata contracts to support message schemas (`{ data?: validator }`) and gateway options (`guards`, `maxPayloadLength`).
2. `@aponiajs/platform-elysia`:
   - In `websockets/websocket-gateway.ts`: compile validation invokers that validate incoming `message.data` using `validateRouteSlot` or standard schema runner before calling handlers.
   - Wire handshake guards into Elysia `.ws(path, { beforeHandle: ... })` to guard the HTTP connection upgrade.
   - Enforce payload length bounds during message parsing.
3. Update `defineWebSocketGateway` to support these declared properties.
4. Testing across Bun and Vite+ lanes.

**Tech Stack:** TypeScript (strict, ESM), Elysia 1.4.x / 2.x native WebSocket, Standard Schema (`~standard`), TypeBox, Bun test, Vite+ conformance.

**Spec:** `docs/superpowers/specs/2026-10-04-aponia-websocket-hardening-design.md`

## Global Constraints

- No Elysia or Bun runtime dependencies in `@aponiajs/common`.
- Preserve existing `{ event, data }` JSON protocol and exception envelope format.
- Backward compatibility: gateways without schemas or guards continue operating identically with zero overhead.
- Aggregate line and function coverage must stay ≥ 95%.
- All code, comments, and documentation must be English.

## Review Focus

1. **Schema validation error safety:** Validation failures must return `{ event: "exception", data: { code: "INVALID_WEBSOCKET_MESSAGE", message: ... } }` and must never crash the socket or leak stack traces.
2. **Handshake rejection timing:** A rejected handshake guard must refuse the connection during HTTP upgrade (answering 403 or throwing `HttpError`) before the socket is upgraded, and must never open the socket or call `handleConnection`.
3. **Async schema compatibility:** Standard Schema validators (e.g. Zod, ArkType) that return Promises must be seamlessly awaited without dropping socket messages.
4. **Declared vs Decorated parity:** `defineWebSocketGateway` must support the exact same schema and guard configuration as `@WebSocketGateway` and `@SubscribeMessage`.
5. **Payload limit enforcement:** Oversized message frames must be rejected safely with an exception frame.

---

### Task 1: Contracts and Metadata in `@aponiajs/common`

**Files:**

- Modify: `packages/common/src/websockets/websocket-gateway.types.ts`
- Modify: `packages/common/src/websockets/websocket-gateway.ts`
- Test: `packages/common/tests/websocket-metadata.test.ts`

**Interfaces:**

- Produces: `WebSocketMessageSchema`, updated `WebSocketGatewayOptions`, updated `SubscribeMessage` signature.

- [ ] **Step 1: Write failing tests for message schema and gateway guard metadata**

Test that `@SubscribeMessage("event", { data: schema })` records the schema in metadata, and `@WebSocketGateway({ path: "/ws", guards: [AuthGuard] })` records the guards.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test packages/common/tests/websocket-metadata.test.ts`

- [ ] **Step 3: Update metadata decorators and types in `@aponiajs/common`**

Add `WebSocketMessageSchema` and update `@SubscribeMessage` to store schema.
Update `WebSocketGatewayOptions` to accept `guards` and `maxPayloadLength`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/common/tests/websocket-metadata.test.ts`

- [ ] **Step 5: Commit changes**

Commit: `feat(common): add schema validation and handshake guard metadata to websocket decorators`

---

### Task 2: Per-Message Validation in `@aponiajs/platform-elysia`

**Files:**

- Modify: `packages/platform-elysia/src/websockets/websocket-gateway.ts`
- Modify: `packages/platform-elysia/src/websockets/gateway-plan.types.ts`
- Modify: `packages/platform-elysia/src/websockets/gateway-definition.ts`
- Test: `packages/platform-elysia/tests/websocket-validation.test.ts`

- [ ] **Step 1: Write failing integration test for message schema validation**

Test that a gateway with `@SubscribeMessage("chat", { data: zodSchema })`:

- Valid payload invokes handler with parsed data and returns response.
- Invalid payload sends `INVALID_WEBSOCKET_MESSAGE` exception frame without invoking handler.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test packages/platform-elysia/tests/websocket-validation.test.ts`

- [ ] **Step 3: Implement validation runner in gateway message dispatcher**

Compile message validators when `schema.data` is provided. In `dispatchWebSocketMessage`, validate incoming `data` against Standard Schema / TypeBox. Return `INVALID_WEBSOCKET_MESSAGE` on validation issues.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform-elysia/tests/websocket-validation.test.ts`

- [ ] **Step 5: Commit changes**

Commit: `feat(platform-elysia): implement per-message schema validation for websocket gateways`

---

### Task 3: Handshake Upgrade Guards and Payload Limits

**Files:**

- Modify: `packages/platform-elysia/src/websockets/websocket-gateway.ts`
- Test: `packages/platform-elysia/tests/websocket-guards.test.ts`
- Test: `packages/platform-elysia/tests-vp/websocket.conformance.ts`

- [ ] **Step 1: Write failing tests for handshake guards and payload limits**

Test that:

- An unauthorized upgrade request is rejected at the HTTP upgrade phase (HTTP 403) and WebSocket connection is not established.
- An authorized upgrade succeeds and opens the socket.
- Messages exceeding `maxPayloadLength` are rejected safely.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test packages/platform-elysia/tests/websocket-guards.test.ts`

- [ ] **Step 3: Implement upgrade hooks in `registerWebSocketGateways`**

Attach `beforeHandle` on the Elysia `.ws(path, ...)` route definition to execute resolved gateway guards before upgrading the socket connection.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/platform-elysia/tests/websocket-guards.test.ts`

- [ ] **Step 5: Commit changes**

Commit: `feat(platform-elysia): implement handshake upgrade guards and payload bounds for websocket gateways`

---

### Task 4: Documentation and Final Verification

**Files:**

- Modify: `docs/websockets.md`
- Modify: `packages/platform-elysia/README.md`
- Modify: `packages/common/llms.txt`
- Modify: `packages/platform-elysia/llms.txt`

- [ ] **Step 1: Update documentation and llms.txt**

Document message validation with Standard Schema and handshake guards in `docs/websockets.md`.

- [ ] **Step 2: Run full verification gates**

Run:

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
bun run test:generated-app
bun audit --audit-level=high
```

- [ ] **Step 3: Bump version and push**

Run `bun run version:beta` and push to `origin/tanya` (PR #64).
