import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  createToken,
  provideValue,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { createServicePlugin } from "../src/plugins/service-plugin.ts";

class MockDatabaseClient {
  constructor(readonly url: string) {}

  query(sql: string): string {
    return `Query "${sql}" executed against ${this.url}`;
  }
}

const DB_CLIENT = createToken<MockDatabaseClient>("test.db.client");

const DatabaseModule = createServicePlugin<MockDatabaseClient, { url: string }>({
  name: "mock-database",
  service: DB_CLIENT,
  factory: (options) => new MockDatabaseClient(options.url),
});

@Injectable()
class UsersService {
  constructor(@Inject(DB_CLIENT) private readonly db: MockDatabaseClient) {}

  findUsers(): string {
    return this.db.query("SELECT * FROM users");
  }
}

@Controller("users")
class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("/")
  getUsers(): string {
    return this.usersService.findUsers();
  }
}

describe("createServicePlugin", () => {
  test("registers a service plugin with static options using forRoot", async () => {
    @Module({
      controllers: [UsersController],
      providers: [UsersService],
      imports: [DatabaseModule.forRoot({ url: "postgres://localhost:5432/main" })],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });

    try {
      const res = await app.handle(new Request("http://localhost/users"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(
        'Query "SELECT * FROM users" executed against postgres://localhost:5432/main',
      );
    } finally {
      await app.close();
    }
  });

  test("registers a service plugin with asynchronous options using forRootAsync", async () => {
    const CONFIG_TOKEN = createToken<{ dbUrl: string }>("test.db.config");

    @Module({
      providers: [provideValue(CONFIG_TOKEN, { dbUrl: "postgres://remote:5432/production" })],
      exports: [CONFIG_TOKEN],
    })
    class ConfigModule {}

    @Module({
      controllers: [UsersController],
      providers: [UsersService],
      imports: [
        ConfigModule,
        DatabaseModule.forRootAsync({
          imports: [ConfigModule],
          inject: [CONFIG_TOKEN],
          useFactory: (cfg) => ({ url: cfg.dbUrl }),
        }),
      ],
    })
    class AppModule {}

    const app = await AponiaFactory.create(AppModule, { logger: false });

    try {
      const res = await app.handle(new Request("http://localhost/users"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(
        'Query "SELECT * FROM users" executed against postgres://remote:5432/production',
      );
    } finally {
      await app.close();
    }
  });
});
