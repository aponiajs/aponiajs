# Audit Events

`@aponiajs/audit` records bounded, redacted events for security and business
operations. It is a leaf package: it mounts no route and makes no authorization
decision.

```ts
@Module({ imports: [AuditModule.register({ redact: ["ssn"] })] })
export class AppModule {}
```

```ts
import { Injectable } from "@aponiajs/common";
import { AuditService } from "@aponiajs/audit";

@Injectable()
class LoginService {
  constructor(private readonly audit: AuditService) {}

  async login(userId: string, tenant: string): Promise<void> {
    await this.audit.record({
      action: "user.login",
      outcome: "success",
      actor: userId,
      tenant,
      resource: "session",
      metadata: { password: "not-recorded", plan: "pro" },
    });
  }
}
```

Events are frozen and timestamped. Metadata is copied, recursively redacted, and
frozen before the event is stored: a nested `{ user: { password } }` is redacted,
and mutating the caller's object after `record` cannot rewrite history. A cycle
becomes `[circular]`; nesting beyond eight levels becomes `[truncated]`.
Sensitive keys are replaced with `[redacted]`; `redact` adds
application-specific keys. The default `MemoryAuditStore` is bounded and evicts
the oldest event. A production deployment supplies a durable `AuditStore`; the
package does not pretend to be one.

`list(limit?)` returns the most recent events, newest last. `clear()` empties the
store. An empty action or invalid bound fails the boot or write with
`INVALID_AUDIT_OPTIONS`.
