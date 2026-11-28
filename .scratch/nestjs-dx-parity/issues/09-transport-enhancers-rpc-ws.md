# Transport Enhancers for Microservices and WebSockets

Type: grilling
Status: open
Blocked by: 01, 03, 04, 05

## Question

Settle how NestJS's transport enhancer pipeline executes beyond HTTP:

1. **Microservices (`@aponiajs/microservices`)**: How should `@UseGuards`, `@UseInterceptors`, `@UsePipes` (plus `@Payload(pipe)`), `@UseFilters`, and `APP_*` enhancers execute around `@MessagePattern()` and `@EventPattern()` handlers (with `ExecutionContext.getType() === "rpc"`, `switchToRpc().getData()` / `getContext()`, request-scoped/durable providers per message, `RpcException`, and mapping filter outputs vs uncaught failures onto `MicroserviceFailure` envelopes across all broker adapters and `grpcTransport`)?
2. **WebSocket gateways (Elysia, Hono, H3)**: How should `@UseInterceptors`, `@UsePipes` / `@MessageBody(pipe)`, and `@UseFilters` (`switchToWs().getClient()` / `getData()` / `getPattern()`) execute per gateway message, and how should `WsException` / `HttpException` / `AponiaError` map onto `{ event: "exception", data }`?
3. **Shared pipeline seam**: How should `@aponiajs/platform-core` share enhancer resolution and execution across HTTP, WS, and RPC while respecting package dependency boundaries?
