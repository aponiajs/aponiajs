# @aponiajs/audit

Bounded, redacting audit events for AponiaJS.

```bash
bun add @aponiajs/audit@beta
```

```ts
import { Module } from "@aponiajs/common";
import { AuditModule, AuditService } from "@aponiajs/audit";

@Module({ imports: [AuditModule.register({ redact: ["ssn"] })] })
export class AppModule {}

@Injectable()
export class LoginService {
  constructor(private readonly audit: AuditService) {}

  async login(userId: string) {
    await this.audit.record({
      action: "user.login",
      outcome: "success",
      actor: userId,
      metadata: { password: "not-recorded", plan: "pro" },
    });
  }
}
```

## Behavior

- `record` returns a frozen event with a timestamp and frozen metadata.
- Sensitive keys (`secret`, `token`, `password`, `authorization`, `api-key`,
  `cookie`) are replaced with `[redacted]`; `redact` adds application-specific keys.
- The default `MemoryAuditStore` is bounded and evicts the oldest event.
- `list(limit?)` returns the most recent events, newest last; `clear()` empties the store.
- An empty action or invalid bound fails with `INVALID_AUDIT_OPTIONS`.

This package records events. It does not mount a route, decide who may read the
stream, or persist events beyond the supplied store. A production deployment
supplies a durable `AuditStore`.

## Documentation

- [Audit guide](../../docs/audit.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/audit)
