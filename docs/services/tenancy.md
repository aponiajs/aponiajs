# Multi-Tenancy

`@aponiajs/tenancy` resolves a tenant identifier for each request and stores it
in the request context.

```ts
@Module({ imports: [TenantModule.register({ header: "x-tenant-id" })] })
export class AppModule {}
```

```ts
@Controller("users")
@UseGuards(TenantGuard)
export class UsersController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  list() {
    return this.tenant.require();
  }
}
```

A tenant source is explicit: provide one of `resolver`, `principal`, or `header`.
A registration with none of them fails at boot with `INVALID_TENANCY_OPTIONS`.
The default policy is required, and the default identifier pattern accepts 1-128
characters from `A-Za-z0-9._:-`.

Resolution order is `resolver` → verified `principal` claim → explicitly
configured `header`. The `principal` option names a request-context token that
holds the verified principal (for example `AUTH_USER` from `@aponiajs/auth`) and
`claim` names the tenant claim, defaulting to `tenantId`:

```ts
import { AUTH_USER } from "@aponiajs/auth";

@Module({ imports: [TenantModule.register({ principal: AUTH_USER })] })
export class AppModule {}
```

The header path is opt-in and is **selection, not authorization**: a request can
name any tenant id, so an application that authenticates requests must still
authorize membership in that tenant. Prefer `principal` or a `resolver` that
reads the verified user.

The package resolves an identifier. It does not store tenants, select database
connections, or add tenant filters to repositories; those belong to the data
layer. A missing tenant answers `400`; `TenantService.require()` answers
`MISSING_TENANT` when called without one, and the default boundary maps that code
to `400`.
