import { Module } from "@aponiajs/common";
import { authModule, metricsModule, queueModule } from "./infrastructure.ts";
import { UsersModule } from "./users/users.module.ts";

/**
 * The reference application: user flows over auth, database, queue, and metrics.
 *
 * The infrastructure registrations live in one module so every module that
 * injects them shares one instance; a second `register()` call would build a
 * second graph and its exported tokens would be ambiguous.
 */
@Module({
  imports: [UsersModule, authModule, queueModule, metricsModule],
})
export class AppModule {}
