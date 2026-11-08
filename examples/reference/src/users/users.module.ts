import { Module } from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/platform-elysia";
import { AppConfig } from "../config.ts";
import { authModule, databaseModule, metricsModule, queueModule } from "../infrastructure.ts";
import { AuthController } from "./auth.controller.ts";
import { PublicController, UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

/** The application's feature module: user flows over the shared infrastructure. */
@Module({
  imports: [databaseModule, authModule, queueModule, metricsModule],
  controllers: [AuthController, UsersController, PublicController],
  providers: [provideConfiguration(AppConfig), UsersService],
  exports: [UsersService, AppConfig],
})
export class UsersModule {}
