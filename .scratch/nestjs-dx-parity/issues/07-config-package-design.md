# Config Package Design (@aponiajs/config)

Type: grilling
Status: open
Blocked by: 01

## Question

Define the contract and boundaries of the new `@aponiajs/config` package so it matches `@nestjs/config` DX while honoring AponiaJS rules (Standard Schema validation, `ConfigurableModuleBuilder` / `moduleOptionsProviders`, platform-neutrality, and zero unvalidated `process.env` leaks):

1. **`ConfigModule`**: Exact options and semantics for `ConfigModule.forRoot(options)` (`isGlobal`, `ignoreEnvFile`, `envFilePath`, `load`, `validate`, `validationSchema`, `expandVariables`, `cache`, `skipProcessEnv`, `ignoreEnvVars`), `ConfigModule.forFeature(configFactory)`, and `ConfigModule.forRootAsync(...)`.
2. **`ConfigService` & `registerAs`**: Exact API for `ConfigService<K, WasValidated>` (`get`, `getOrThrow`, dot-path lookup, `infer` from `validationSchema`/`validate`), `registerAs(namespace, factory)`, `ConfigType<typeof factory>`, and interop/migration with `provideConfiguration` / `defineConfiguration`.
3. **Dependencies & workspace integration**: Choose a maintained Bun-compatible `.env` parser/expander per `AGENTS.md` "Reuse Before Build", and list package manifests, `tsconfig.json`, `vite.config.ts` aliases, `scripts/coverage-gate.ts`, and `scripts/library-catalog.spec.ts` requirements.
