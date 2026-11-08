# Audit Events

`@aponiajs/audit` records bounded, redacted events for security and business
operations. It is a leaf package: it mounts no route and makes no authorization
decision.

```ts
@Module({ imports: [AuditModule.register({ redact: ["ssn"] })] })
export class AppModule {}
```

```ts
await audit.record({
  action: "user.login",
  outcome: "success",
  actor: user.id,
  tenant: user.tenant,
  resource: "session",
  metadata: { password: "not-recorded", plan: "pro" },
});
```

Events are frozen and timestamped. Sensitive metadata keys are replaced with
`[redacted]`; `redact` adds application-specific keys. The default
`MemoryAuditStore` is bounded and evicts the oldest event. A production
deployment supplies a durable `AuditStore`; the package does not pretend to be
one.

`list(limit?)` returns the most recent events, newest last. `clear()` empties the
store. An empty action or invalid bound fails the boot or write with
`INVALID_AUDIT_OPTIONS`.
