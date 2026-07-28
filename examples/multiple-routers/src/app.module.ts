import { Module } from "@aponiajs/common";
import { CatalogModule } from "./catalog.module.ts";
import { HealthController } from "./health.controller.ts";
import { ItemsController } from "./items.controller.ts";

/**
 * Several routers in one application. Each controller owns a path prefix, and
 * `@Module` decides which of them a feature exposes.
 */
@Module({
  imports: [CatalogModule],
  controllers: [ItemsController, HealthController],
})
export class AppModule {}
