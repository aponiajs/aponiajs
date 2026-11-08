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

The default header is `x-tenant-id`, the default policy is required, and the
default identifier pattern accepts 1-128 characters from `A-Za-z0-9._:-`. A
`resolver` can derive the tenant from an authenticated user claim and runs before
the header.

The package resolves an identifier. It does not store tenants, select database
connections, or add tenant filters to repositories; those belong to the data
layer. A missing tenant answers `400`; `TenantService.require()` answers
`MISSING_TENANT` when called without one.
