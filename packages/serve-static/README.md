# @aponiajs/serve-static

Nest-compatible `ServeStaticModule` for serving static assets and single-page applications on any AponiaJS platform.

## Usage

```ts
import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { ServeStaticModule } from "@aponiajs/serve-static";

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: "./public",
      serveRoot: "/static",
      exclude: ["/api*"],
    }),
  ],
})
class AppModule {}

const app = await AponiaFactory.create(AppModule);
```
