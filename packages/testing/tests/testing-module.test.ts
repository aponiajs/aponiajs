import { describe, expect, test } from "bun:test";
import {
  Controller,
  createToken,
  Get,
  Inject,
  Injectable,
  Module,
  provideValue,
  Scope,
} from "@aponiajs/common";
import { Test } from "../src/index.ts";

const DATABASE_TOKEN = createToken<DatabaseService>("test.database");

interface DatabaseService {
  query(sql: string): string[];
}

@Injectable()
class RealDatabaseService implements DatabaseService {
  query(_sql: string): string[] {
    return ["real-1", "real-2"];
  }
}

@Injectable()
class UsersService {
  constructor(@Inject(DATABASE_TOKEN) readonly db: DatabaseService) {}

  getUsers(): string[] {
    return this.db.query("SELECT * FROM users");
  }
}

@Controller("/users")
class UsersController {
  constructor(readonly usersService: UsersService) {}

  @Get()
  list(): string[] {
    return this.usersService.getUsers();
  }
}

@Module({
  providers: [provideValue(DATABASE_TOKEN, new RealDatabaseService())],
  exports: [DATABASE_TOKEN],
})
class DatabaseModule {}

@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
class UsersModule {}

describe("Test.createTestingModule", () => {
  test("compiles testing module from metadata and resolves providers via get()", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule],
    }).compile();

    const usersService = moduleRef.get(UsersService);
    expect(usersService).toBeInstanceOf(UsersService);
    expect(usersService.getUsers()).toEqual(["real-1", "real-2"]);
  });

  test("compiles testing module from root module class directly", async () => {
    const moduleRef = await Test.createTestingModule(UsersModule).compile();

    const usersService = moduleRef.get(UsersService);
    expect(usersService).toBeInstanceOf(UsersService);
    expect(usersService.getUsers()).toEqual(["real-1", "real-2"]);
  });

  test("overrides provider with useValue", async () => {
    const mockDb: DatabaseService = {
      query: () => ["mock-user-1", "mock-user-2"],
    };

    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule],
    })
      .overrideProvider(DATABASE_TOKEN)
      .useValue(mockDb)
      .compile();

    const usersService = moduleRef.get(UsersService);
    expect(usersService.getUsers()).toEqual(["mock-user-1", "mock-user-2"]);
    expect(moduleRef.get(DATABASE_TOKEN)).toBe(mockDb);
  });

  test("overrides provider with useFactory (both object and function signatures)", async () => {
    // Object signature
    const moduleRef1 = await Test.createTestingModule({
      imports: [UsersModule],
    })
      .overrideProvider(DATABASE_TOKEN)
      .useFactory({ factory: () => ({ query: () => ["factory-mock-1"] }) })
      .compile();

    expect(moduleRef1.get(UsersService).getUsers()).toEqual(["factory-mock-1"]);

    // Function signature
    const moduleRef2 = await Test.createTestingModule({
      imports: [UsersModule],
    })
      .overrideProvider(DATABASE_TOKEN)
      .useFactory(() => ({ query: () => ["factory-mock-2"] }))
      .compile();

    expect(moduleRef2.get(UsersService).getUsers()).toEqual(["factory-mock-2"]);
  });

  test("overrides provider with useClass", async () => {
    class MockDatabaseService implements DatabaseService {
      query(): string[] {
        return ["class-mock-1"];
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule],
    })
      .overrideProvider(DATABASE_TOKEN)
      .useClass(MockDatabaseService)
      .compile();

    const usersService = moduleRef.get(UsersService);
    expect(usersService.getUsers()).toEqual(["class-mock-1"]);
    expect(moduleRef.get(DATABASE_TOKEN)).toBeInstanceOf(MockDatabaseService);
  });

  test("resolves unexported provider within an imported module for unit testing", async () => {
    const internalToken = createToken<string>("internal.token");

    @Module({
      providers: [provideValue(internalToken, "secret-internal-value")],
      // internalToken is intentionally NOT exported
    })
    class InternalModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [InternalModule],
    }).compile();

    expect(moduleRef.get(internalToken)).toBe("secret-internal-value");
  });

  test("resolves scoped providers via resolve(token, context)", async () => {
    let count = 0;

    @Injectable({ scope: Scope.TRANSIENT })
    class TransientItem {
      readonly id = ++count;
    }

    let reqCount = 0;
    @Injectable({ scope: Scope.REQUEST })
    class RequestItem {
      readonly id = ++reqCount;
    }

    const moduleRef = await Test.createTestingModule({
      providers: [TransientItem, RequestItem],
    }).compile();

    const t1 = await moduleRef.resolve(TransientItem);
    const t2 = await moduleRef.resolve(TransientItem);
    expect(t1).not.toBe(t2);

    const ctx1 = { id: 1 };
    const ctx2 = { id: 2 };
    const r1A = await moduleRef.resolve(RequestItem, ctx1);
    const r1B = await moduleRef.resolve(RequestItem, ctx1);
    const r2 = await moduleRef.resolve(RequestItem, ctx2);
    expect(r1A).toBe(r1B);
    expect(r1A).not.toBe(r2);
  });

  test("boots complete HTTP application via createAponiaApplication() with overrides intact", async () => {
    const mockDb: DatabaseService = {
      query: () => ["http-mock-user"],
    };

    const moduleRef = await Test.createTestingModule({
      imports: [UsersModule],
    })
      .overrideProvider(DATABASE_TOKEN)
      .useValue(mockDb)
      .compile();

    const app = await moduleRef.createAponiaApplication();
    const response = await app.handle(new Request("http://localhost/users"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(["http-mock-user"]);

    await moduleRef.close();
  });

  test("runs lifecycle onModuleDestroy hooks on close() and is idempotent", async () => {
    let destroyed = 0;
    class DestroyTracker {
      onModuleDestroy() {
        destroyed++;
      }
    }
    const token = createToken<DestroyTracker>("destroy.tracker");

    const moduleRef = await Test.createTestingModule({
      providers: [provideValue(token, new DestroyTracker())],
    }).compile();

    expect(destroyed).toBe(0);
    await moduleRef.close();
    expect(destroyed).toBe(1);
    await moduleRef.close();
    expect(destroyed).toBe(1);
  });

  test("throws MISSING_PROVIDER when overriding a non-existent provider", async () => {
    const missingToken = createToken<string>("missing.token");

    let failure: unknown;
    try {
      await Test.createTestingModule({
        imports: [UsersModule],
      })
        .overrideProvider(missingToken)
        .useValue("nope")
        .compile();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "MISSING_PROVIDER",
      details: { token: "missing.token" },
    });
  });
});
