# CLI Starter Templates and Resource DX

Type: grilling
Status: open
Blocked by: 06, 07, 08

## Question

Decide how `@aponiajs/cli` templates (`aponia new` and `aponia generate`) should present NestJS-idiomatic DX using `@aponiajs/*` packages:

1. **`aponia new` starter**: How should `AppModule`, `src/config.ts`, `main.ts`, and `test/app.e2e-spec.ts` adopt `ConfigModule.forRoot({ isGlobal: true, ... })` + `ConfigService`, `ValidationPipe`, and `createNestApplication()` / `init()` while keeping `@aponiajs/*` imports and `aponia-cli.json`?
2. **`aponia generate resource`**: How should generated REST/WS/Microservice resources combine Nest-shaped DTO files (`dto/create-<name>.dto.ts`, `dto/update-<name>.dto.ts` with `PartialType(...)`) and `@Validation()` / Standard Schema validation (replacing or offering an alternative to `<name>.model.ts`)?
3. **Docs & guard synchronization**: List exact updates needed in `docs/build/migrating-from-nest.md`, `docs/build/enhancers.md`, `docs/build/dependency-injection.md`, `ROADMAP.md`, `scripts/documentation.spec.ts`, and `bun run test:generated-app`.
