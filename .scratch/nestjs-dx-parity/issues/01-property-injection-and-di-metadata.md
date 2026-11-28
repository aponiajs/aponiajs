# Property Injection and Core DI Metadata

Type: grilling
Status: open

## Question

Settle the exact contracts and invariants in `@aponiajs/common` and `@aponiajs/core` (preserving `common <- core` one-way dependencies and frozen descriptors) for:

1. **Property-based injection**: How should `@Inject(token)` and `@Optional()` work on class properties (including `Scope.REQUEST` bubbling, circular `forwardRef`, subclass inheritance, `ModuleRef.create()`, and descriptor representation)?
2. **Undeclared enhancer/pipe DI resolution**: When `@UseGuards(MyGuard)`, `@UseInterceptors(...)`, `@UsePipes(...)`, `@UseFilters(...)`, `@Param('id', ParseIntPipe)`, or `{ provide: APP_GUARD, useClass: MyGuard }` references a class not listed in `providers`, what are the caching/lifetime rules (`singleton` vs `request` bubbling per owning module vs per-route) and error codes when dependencies are missing?
3. **`Reflector.createDecorator<T>()` & Discovery API**: What exact signatures should `Reflector.createDecorator<T>()` (`.KEY`, `transform` option, `Reflector.get` interop), `DiscoveryService` (`getProviders`, `getControllers`, `getMetadataByDecorator`, `DiscoveryService.createDecorator`), `MetadataScanner` (`getAllMethodNames`), and `ModulesContainer` expose?
4. **Module re-exports via `forwardRef`**: How should `expandExports` in `platform-core` handle `exports: [forwardRef(() => PeerModule)]`?
