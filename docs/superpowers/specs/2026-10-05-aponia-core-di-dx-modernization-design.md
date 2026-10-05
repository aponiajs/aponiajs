# Core DI & DX Modernization — NestJS-Aligned Inversion of Control & Enhanced Developer Experience

Status: Design.

## Why this document

AponiaJS models its architecture after NestJS: modules, controllers, providers, and dependency injection running natively on Bun with Elysia. While the current foundation in `@aponiajs/core` and `@aponiajs/common` successfully enforces clean boundaries, frozen descriptors, and strict visibility rules, it currently exhibits several developer friction points and gaps compared to NestJS:

1. **Opaque Resolution Errors:** When a token cannot be resolved, `MISSING_PROVIDER` merely states `Module "X" cannot resolve token "Y"`. Developers are left guessing whether they forgot to export the provider, forgot to import the module, or mistyped a token.
2. **Missing `@Global()` Modules:** Shared infrastructure providers (e.g. database connections, config, cache, logging) must be imported into every single consuming module. This leads to excessive boilerplate in medium-to-large applications.
3. **No Circular Dependency Support (`forwardRef`):** Legitimate circular relationships between modules or co-dependent domain services cannot be compiled or resolved, causing `PROVIDER_CYCLE` or `MODULE_CYCLE` errors at boot.
4. **Unimplemented Provider Scopes:** While `"request"` and `"transient"` scopes were reserved in types, resolving them throws `UNSUPPORTED_PROVIDER_SCOPE`. Applications cannot model per-request state or transient instances.
5. **Testing Ergonomics:** Creating test harnesses with mocked providers requires manual graph overrides rather than the familiar, fluent `Test.createTestingModule({...}).overrideProvider(...).useValue(...)` API established by NestJS.

This specification modernizes `@aponiajs/core`, `@aponiajs/common`, `@aponiajs/testing`, and `@aponiajs/platform-elysia` to provide full NestJS-aligned ergonomics while preserving AponiaJS's core strengths: descriptor-first architecture, ahead-of-time graph validation, zero runtime overhead, and strict type safety.

---

## Architectural Principles

1. **NestJS Mental Model, Aponia Performance:**
   API semantics, decorator signatures, and configuration naming follow NestJS conventions (`@Global()`, `forwardRef()`, `Scope`, `Test.createTestingModule`). However, execution remains descriptor-driven, eager-validated, and optimized for Bun.
2. **Actionable Diagnostics First:**
   Every failure encountered during graph compilation or container resolution must explain _why_ it failed, inspect the global state to locate candidate origins, and suggest the exact code edit required to fix it.
3. **Deterministic Visibility Rules:**
   Global modules and forward references must not degrade the container into an untyped global bag. Precedence is deterministic: Local providers > Explicit imports > Global modules > Predefined fallbacks.
4. **Scope Safety & Bubbling:**
   Singletons cannot silently inject request-scoped providers. The dependency graph validates scope hierarchy to prevent memory leaks and state corruption.

---

## Detailed Design & Contracts

### 1. Actionable Diagnostic Errors & Graph Insights

#### The Problem

Currently, missing or ambiguous providers produce minimal details:

```text
[AponiaError] MISSING_PROVIDER: Module "OrdersModule" cannot resolve token "UsersService".
```

The developer does not know if `UsersService` exists elsewhere, which module owns it, or why it isn't visible.

#### The Solution

Enhance `ModuleGraph.locate` and `GraphCompiler` to perform holistic graph analysis when a resolution fails:

1. Search all modules in the graph for providers matching `token`.
2. Inspect relationship between requesting module $M_{req}$ and owning module $M_{owner}$.
3. Generate actionable, human-readable hints in `details.hints`.

#### Diagnostic Scenarios

- **Scenario A (Declared in imported module, but not exported):**
  $M_{req}$ imports $M_{owner}$, and $M_{owner}$ declares `UsersService` in `providers`, but omitted it from `exports`.
  _Hint:_ `"UsersService is declared in imported module 'UsersModule', but 'UsersModule' does not export it. Add 'UsersService' to UsersModule.exports."*
- **Scenario B (Declared in unimported module):**
  `UsersModule` declares `UsersService`, but $M_{req}$ does not import `UsersModule`.
  _Hint:_ `"UsersService is declared in 'UsersModule'. Add 'UsersModule' to OrdersModule.imports and ensure UsersModule exports 'UsersService'."*
- **Scenario C (Declared in a global module, but not exported):**
  `DatabaseModule` is `@Global()`, but `DatabaseService` is not in its `exports`.
  _Hint:_ `"DatabaseModule is marked as @Global(), but does not export 'DatabaseService'. Add 'DatabaseService' to DatabaseModule.exports."*
- **Scenario D (Token completely missing):**
  No module in the graph declares `token`.
  _Hint:_ `"No module in the application declares token 'UsersService'. Did you forget to add it to OrdersModule.providers or declare a provider for it?"*

#### Enhanced Cycle Visualization

When `PROVIDER_CYCLE` or `MODULE_CYCLE` occurs, format the cycle chain visually:

```text
[AponiaError] PROVIDER_CYCLE: Circular dependency detected:
OrdersService -> PaymentService -> InventoryService -> OrdersService
```

---

### 2. Global Modules (`@Global()` / `global: true`)

#### Concept

In NestJS, `@Global()` makes providers exported by a module available everywhere without requiring other modules to import it.

#### Decorator & Metadata Contract

```ts
// packages/common/src/decorators/decorators.ts
export function Global(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(Symbol.for("aponia.global.metadata"), true, target);
  };
}

// packages/common/src/modules/module.types.ts
export interface ModuleDefinition {
  readonly id: string;
  readonly instanceId?: string;
  readonly global?: boolean;
  readonly imports: readonly ModuleDefinition[];
  readonly controllers: readonly ControllerDefinition[];
  readonly providers: readonly Provider[];
  readonly exports: readonly Token<unknown>[];
}
```

#### Graph Compiler & Lookup Rules

In `compileModuleGraph`:

- Track all global modules in `ModuleGraph.globalModules`.
- Validate that global modules export at least one token (otherwise `@Global()` is redundant).
- In `ModuleGraph.locate(module, token)`:
  1. Check `module.providers` (Local override wins).
  2. Check `module.imports` that export `token` (Explicit import wins).
  3. Check `ModuleGraph.globalModules` that export `token`.
     - If exactly one global module exports `token`, resolve to it.
     - If two or more global modules export the same token, throw `AMBIGUOUS_PROVIDER` detailing the conflicting global modules.
  4. Check predefined system providers (e.g. `LOGGER`).
  5. If still unlocated, run diagnostic analyzer and throw `MISSING_PROVIDER`.

---

### 3. Circular Dependencies Handling (`forwardRef`)

#### Concept

When two modules or providers depend on each other (e.g., `UsersModule` $\leftrightarrow$ `AuthModule`, or `UsersService` $\leftrightarrow$ `AuthService`), imports cannot resolve immediately because one class is undefined at evaluation time. `forwardRef(() => Target)` defers resolution using a thunk.

#### Contract in `@aponiajs/common`

```ts
// packages/common/src/modules/forward-ref.ts
export const FORWARD_REF_SYMBOL = Symbol.for("aponia.forward-ref");

export interface ForwardReference<T = unknown> {
  readonly [FORWARD_REF_SYMBOL]: true;
  readonly forwardRef: () => T;
}

export function forwardRef<T = unknown>(fn: () => T): ForwardReference<T> {
  return Object.freeze({
    [FORWARD_REF_SYMBOL]: true,
    forwardRef: fn,
  });
}

export function isForwardRef(value: unknown): value is ForwardReference {
  return typeof value === "object" && value !== null && (value as any)[FORWARD_REF_SYMBOL] === true;
}

export function resolveForwardRef<T>(target: T | ForwardReference<T>): T {
  return isForwardRef(target) ? (target.forwardRef() as T) : target;
}
```

#### Module Forward References

```ts
@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

During module graph compilation:

- Unpack `forwardRef` thunks when walking module dependencies.
- Allow cycles in `imports` **if and only if** at least one edge in the cycle was declared with `forwardRef`.

#### Provider Forward References

```ts
@Injectable()
export class UsersService {
  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}
}
```

During container resolution:

- When instantiating `UsersService`, if `AuthService` is in the resolving stack and declared via `forwardRef`, supply a lazy Proxy wrapper:
  ```ts
  const lazyProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const realInstance = container.resolveModuleProvider(authModule, AuthService);
        return Reflect.get(realInstance, prop);
      },
    },
  );
  ```
- Once both are instantiated, the proxy transparently delegates without cyclic deadlock.

---

### 4. Provider Scopes (`Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT`)

#### Scope Enum & Decorator Support

```ts
// packages/common/src/providers/provider.types.ts
export const Scope = {
  DEFAULT: "singleton",
  REQUEST: "request",
  TRANSIENT: "transient",
} as const;

export type ProviderScope = (typeof Scope)[keyof typeof Scope];

// @Injectable options
export interface InjectableOptions {
  readonly scope?: ProviderScope;
}

export function Injectable(options?: InjectableOptions): ClassDecorator;
```

#### Container Lifetime Management

1. **`Scope.DEFAULT` (Singleton):**
   - Instantiated once per declaring module.
   - Cached in `AponiaContainer.#instances`.
2. **`Scope.TRANSIENT`:**
   - A fresh instance is created on every injection or `get()` call.
   - Never cached in container instance map.
3. **`Scope.REQUEST`:**
   - Cached inside a per-request sub-container / `RequestContext`.
   - Associated with `AsyncLocalStorage` in `@aponiajs/platform-elysia`.
   - Cleared automatically when the request completes.

#### Scope Bubbling Rule

In accordance with NestJS semantics:

- A Singleton provider **cannot** depend on a Request-scoped provider.
- If provider $A$ (singleton) depends on provider $B$ (request-scoped), either:
  1. $A$ must also be declared with `scope: Scope.REQUEST` (automatic or eager compile-time validation error `INVALID_SCOPE_HIERARCHY`).
  2. Compile-time check catches this: `"Singleton provider 'A' cannot depend on request-scoped provider 'B'. Change 'A' scope to REQUEST."`

---

### 5. Testing DX (`Test.createTestingModule`)

#### Concept

Make testing intuitive and identical to NestJS unit/integration testing workflows:

```ts
import { Test, type TestingModule } from "@aponiajs/testing";

describe("UsersService", () => {
  let service: UsersService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = { query: () => [] };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [UsersModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(mockDb)
      .overrideProvider(ConfigService)
      .useFactory({ factory: () => ({ env: "test" }) })
      .compile();

    service = moduleRef.get(UsersService);
  });

  test("finds users", async () => {
    expect(await service.findAll()).toEqual([]);
  });
});
```

#### API Surface in `@aponiajs/testing`

```ts
export class Test {
  static createTestingModule(metadata: ModuleMetadata): TestingModuleBuilder;
}

export interface TestingModuleBuilder {
  overrideProvider<T>(token: Token<T>): OverrideProviderBuilder<T>;
  overrideModule(module: ModuleClass | ModuleDefinition): OverrideModuleBuilder;
  compile(): Promise<TestingModule>;
}

export interface OverrideProviderBuilder<T> {
  useValue(value: T): TestingModuleBuilder;
  useClass(metatype: ClassToken<T>): TestingModuleBuilder;
  useFactory(factory: {
    factory: (...args: any[]) => T;
    inject?: readonly Token<unknown>[];
  }): TestingModuleBuilder;
}

export interface TestingModule {
  get<T>(token: Token<T>): T;
  resolve<T>(token: Token<T>): Promise<T>;
  createAponiaApplication(options?: AponiaApplicationOptions): Promise<AponiaApplication>;
  close(): Promise<void>;
}
```

---

## Verification & Safety

1. **Unit & Conformance Coverage:**
   - 100% test coverage on new graph compiler paths, scope resolvers, and diagnostic analyzers.
   - Vite+ conformance tests for all public contract changes in `tests-vp/`.
2. **Backward Compatibility:**
   - Existing applications using pure singletons and standard modules experience zero breaking changes.
   - Hand-written descriptors (`defineModule`, `provideValue`, etc.) support `global`, `scope`, and `forwardRef` seamlessly.
3. **Performance Invariant:**
   - Compile-time diagnostic search executes **only** when an error occurs (`locate` misses), ensuring zero impact on successful boot times.
