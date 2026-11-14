import { expect, test } from "bun:test";
import {
  AponiaError,
  Controller,
  Get,
  Global,
  Inject,
  Injectable,
  Module,
  createToken,
  forwardRef,
  provideClass,
  provideValue,
  resolveForwardRef,
  type DynamicModule,
} from "@aponiajs/common";
import { AponiaFactory, compileRootModule } from "../src/index.ts";

@Injectable()
class BaseMergeService {
  read(): string {
    return "base";
  }
}

@Controller("merge-base")
class BaseMergeController {
  constructor(private readonly service: BaseMergeService) {}

  @Get()
  read(): string {
    return this.service.read();
  }
}

@Module({
  controllers: [BaseMergeController],
  providers: [BaseMergeService],
  exports: [BaseMergeService],
})
class MergeBaseModule {}

@Controller("merge-dynamic")
class DynamicMergeController {
  @Get()
  read(): string {
    return "dynamic";
  }
}

@Module({ controllers: [DynamicMergeController] })
class DynamicMergeImportModule {}

const dynamicMergeValue = createToken<string>("merge.dynamic-value");

const mergedDynamicModule: DynamicModule = {
  module: MergeBaseModule,
  id: "MergedEdgeModule",
  instanceId: Symbol("merged-edge-module"),
  imports: [DynamicMergeImportModule],
  controllers: [DynamicMergeController],
  providers: [provideValue(dynamicMergeValue, "configured")],
  exports: [dynamicMergeValue],
};

test("merges decorated module metadata with the dynamic module that configures it", () => {
  const compiled = compileRootModule(mergedDynamicModule);

  expect(compiled.id).toBe("MergedEdgeModule");
  expect(compiled.instanceId).toBe(mergedDynamicModule.instanceId);
  expect(compiled.imports.map((module) => resolveForwardRef(module).id)).toEqual([
    "DynamicMergeImportModule",
  ]);
  expect(compiled.controllers.map((controller) => controller.token)).toEqual([
    BaseMergeController,
    DynamicMergeController,
  ]);
  expect(compiled.providers).toEqual([
    {
      kind: "class",
      provide: BaseMergeService,
      inject: [],
      useClass: BaseMergeService,
    },
    {
      kind: "value",
      provide: dynamicMergeValue,
      useValue: "configured",
    },
  ]);
  expect(compiled.exports).toEqual([BaseMergeService, dynamicMergeValue]);
  expect(Object.isFrozen(compiled)).toBe(true);
  expect(Object.isFrozen(compiled.imports)).toBe(true);
  expect(Object.isFrozen(compiled.controllers)).toBe(true);
  expect(Object.isFrozen(compiled.providers)).toBe(true);
  expect(Object.isFrozen(compiled.exports)).toBe(true);
});

test("mounts the decorated and dynamic controllers of a merged module together", async () => {
  const application = await AponiaFactory.create(mergedDynamicModule, { logger: false });
  const base = await application.handle(new Request("http://localhost/merge-base"));
  const dynamic = await application.handle(new Request("http://localhost/merge-dynamic"));

  expect(await base.text()).toBe("base");
  expect(await dynamic.text()).toBe("dynamic");
  await application.close();
});

test("keeps a class module free of the dynamic module that configures it", () => {
  const merged = compileRootModule(mergedDynamicModule);
  const classOnly = compileRootModule(MergeBaseModule);

  expect(merged.controllers).toHaveLength(2);
  expect(classOnly.id).toBe("MergeBaseModule");
  expect(classOnly.instanceId).toBeUndefined();
  expect(classOnly.imports).toEqual([]);
  expect(classOnly.controllers.map((controller) => controller.token)).toEqual([
    BaseMergeController,
  ]);
  expect(classOnly.providers).toHaveLength(1);
  expect(classOnly.exports).toEqual([BaseMergeService]);
});

/**
 * A class nothing decorates.
 *
 * `design:paramtypes` is emitted only for a declaration that carries a decorator,
 * so this one resolves to no dependencies however many parameters its constructor
 * takes — the shape that reaches the compiler when a service is registered without
 * `@Injectable()`.
 */
class BareSettingsService {
  constructor(private readonly name: string) {}

  describe(): string {
    return this.name;
  }
}

@Module({ providers: [BareSettingsService] })
class BareProviderModule {}

/** The same registration for a class that never needed anything from the module. */
class ParameterlessService {
  index(): string {
    return "Hi";
  }
}

@Module({ providers: [ParameterlessService] })
class ParameterlessModule {}

/** The escape: the empty list is stated rather than missing. */
class OptionalService {
  constructor(private readonly name?: string) {}

  describe(): string {
    return this.name ?? "nothing was injected";
  }
}

@Module({ providers: [provideClass(OptionalService, [])] })
class ExplicitlyEmptyModule {}

function captureAponiaError(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected the operation to throw an AponiaError.");
}

test("refuses a class registered on its own whose constructor takes parameters", () => {
  const error = captureAponiaError(() => compileRootModule(BareProviderModule));

  // Nothing about this declaration said anything was wrong: it compiles to a
  // class provider with an empty dependency list, which is exactly what a
  // parameterless class compiles to.
  expect(error.code).toBe("UNRESOLVED_CONSTRUCTOR_DEPENDENCIES");
  expect(error.details).toEqual({
    provider: "BareSettingsService",
    required: 1,
    supplied: 0,
  });
  expect(Object.isFrozen(error.details)).toBe(true);
});

test("accepts the same registration for a class that takes no parameters", () => {
  const compiled = compileRootModule(ParameterlessModule);

  expect(compiled.providers).toHaveLength(1);
  expect(compiled.controllers).toEqual([]);
});

test("accepts an empty dependency list the application stated itself", () => {
  const compiled = compileRootModule(ExplicitlyEmptyModule);

  expect(compiled.providers).toHaveLength(1);
});

test("compiles @Global() decorated modules with global: true", () => {
  @Injectable()
  class GlobalService {
    read(): string {
      return "from-global";
    }
  }

  @Global()
  @Module({
    providers: [GlobalService],
    exports: [GlobalService],
  })
  class AppGlobalModule {}

  const compiled = compileRootModule(AppGlobalModule);
  expect(compiled.global).toBe(true);
});

test("makes @Global() exported provider accessible to controllers across modules without import", async () => {
  @Injectable()
  class SharedDbService {
    query(): string {
      return "db-result";
    }
  }

  @Global()
  @Module({
    providers: [SharedDbService],
    exports: [SharedDbService],
  })
  class DbGlobalModule {}

  @Controller("consumer")
  class ConsumerController {
    constructor(private readonly db: SharedDbService) {}

    @Get()
    get(): string {
      return this.db.query();
    }
  }

  @Module({
    controllers: [ConsumerController],
  })
  class FeatureModule {}

  @Module({
    imports: [DbGlobalModule, FeatureModule],
  })
  class RootAppModule {}

  const application = await AponiaFactory.create(RootAppModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/consumer"));

  expect(await response.text()).toBe("db-result");
  await application.close();
});

test("boots decorated circular modules and providers with forwardRef", async () => {
  let UsersModuleRef: any;
  let AuthModuleRef: any;

  @Injectable()
  class UsersService {
    constructor(@Inject(forwardRef(() => AuthService)) private readonly authService: any) {}

    whoAmI(): string {
      return "UsersService";
    }

    askAuth(): string {
      return `Users asks ${this.authService.whoAmI()}`;
    }
  }

  @Injectable()
  class AuthService {
    constructor(
      @Inject(forwardRef(() => UsersService)) private readonly usersService: UsersService,
    ) {}

    whoAmI(): string {
      return "AuthService";
    }

    askUsers(): string {
      return `Auth asks ${this.usersService.whoAmI()}`;
    }
  }

  @Controller("auth")
  class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Get()
    get(): string {
      return this.authService.askUsers();
    }
  }

  @Module({
    imports: [forwardRef(() => AuthModuleRef)],
    providers: [UsersService],
    exports: [UsersService],
  })
  class UsersModule {}
  UsersModuleRef = UsersModule;

  @Module({
    imports: [forwardRef(() => UsersModuleRef)],
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService],
  })
  class AuthModule {}
  AuthModuleRef = AuthModule;

  @Module({
    imports: [UsersModule, AuthModule],
  })
  class RootModule {}

  const application = await AponiaFactory.create(RootModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/auth"));

  expect(await response.text()).toBe("Auth asks UsersService");
  await application.close();
});

test("keeps two module classes with the same name distinct", () => {
  const First = class AppModule {};
  Module({})(First);
  const Second = class AppModule {};
  Module({})(Second);
  class RootModule {}
  Module({ imports: [First, Second] })(RootModule);

  const definition = compileRootModule(RootModule);
  const imported = definition.imports as readonly {
    readonly id: string;
    readonly moduleIdentity?: symbol;
  }[];

  expect(imported.map((module) => module.id)).toEqual(["AppModule", "AppModule"]);
  expect(new Set(imported.map((module) => module.moduleIdentity)).size).toBe(2);
});

test("lowers a Nest-shaped provider literal in a decorated module", async () => {
  const NEST_SERVICE = createToken<{ read(): string }>("nest.service");

  @Injectable()
  class NestService {
    read(): string {
      return "from-class";
    }
  }

  @Controller("nest-literal")
  class NestLiteralController {
    constructor(@Inject(NEST_SERVICE) private readonly service: { read(): string }) {}

    @Get()
    read(): string {
      return this.service.read();
    }
  }

  @Module({
    controllers: [NestLiteralController],
    providers: [
      { provide: NEST_SERVICE, useClass: NestService },
      { provide: createToken<{ read(): string }>("nest.alias"), useExisting: NEST_SERVICE },
    ],
  })
  class NestLiteralModule {}

  const application = await AponiaFactory.create(NestLiteralModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/nest-literal"));

  expect(await response.text()).toBe("from-class");
  await application.close();
});

test("re-exports an imported module's exports", async () => {
  const VALUE = createToken<string>("reexport.value");

  @Module({ providers: [provideValue(VALUE, "v")], exports: [VALUE] })
  class InnerModule {}

  @Module({ imports: [InnerModule], exports: [InnerModule] })
  class MiddleModule {}

  @Controller("reexport")
  class ReexportController {
    constructor(@Inject(VALUE) private readonly value: string) {}

    @Get()
    read(): string {
      return this.value;
    }
  }

  @Module({ imports: [MiddleModule], controllers: [ReexportController] })
  class OuterModule {}

  const application = await AponiaFactory.create(OuterModule, { logger: false });
  const response = await application.handle(new Request("http://localhost/reexport"));

  expect(await response.text()).toBe("v");
  await application.close();
});

test("refuses re-exporting a module it does not import", () => {
  @Module({})
  class NotImportedModule {}

  @Module({ exports: [NotImportedModule] })
  class BadModule {}

  expect(() => compileRootModule(BadModule)).toThrow(
    expect.objectContaining({ code: "INVALID_EXPORT" }),
  );
});
