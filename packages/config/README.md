# @aponiajs/config

Configuration module for AponiaJS with `.env` loading, variable expansion, namespaces (`registerAs`), and Standard Schema / TypeBox / custom validation.

## Usage

```ts
import { Controller, Get, Module } from "@aponiajs/common";
import { ConfigModule, ConfigService, registerAs } from "@aponiajs/config";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { z } from "zod";

const databaseConfig = registerAs("database", () => ({
  url: process.env["DATABASE_URL"] ?? "sqlite://local.db",
}));

@Controller("config")
class AppController {
  constructor(private readonly config: ConfigService) {}

  @Get("db")
  readDb() {
    return { url: this.config.getOrThrow<string>("database.url") };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      validationSchema: z.object({ PORT: z.coerce.number().default(3000) }),
    }),
  ],
  controllers: [AppController],
})
class AppModule {}

const app = await AponiaFactory.create(AppModule);
```
