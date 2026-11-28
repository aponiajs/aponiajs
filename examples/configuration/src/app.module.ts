import { Module } from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/platform-elysia";
import { AppController } from "./app.controller.ts";
import { AppService } from "./app.service.ts";
import { AppConfig } from "./config.ts";

@Module({
  providers: [provideConfiguration(AppConfig), AppService],
  controllers: [AppController],
  // Exported so a module that imports this one can inject the same value
  // instead of validating the environment a second time.
  exports: [AppConfig],
})
export class AppModule {}
