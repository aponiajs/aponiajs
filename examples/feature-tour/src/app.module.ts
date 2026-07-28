import { Module } from "@aponiajs/common";
import { CatalogModule } from "./catalog/catalog.module.ts";
import { ConfigModule } from "./config/config.module.ts";
import { metricsModule } from "./descriptors/metrics.module.ts";
import { ParametersController } from "./parameters/parameters.controller.ts";
import { PluginsModule } from "./plugins/plugins.module.ts";

/**
 * Use case: a root module composing decorated modules, a hand-written
 * descriptor module, and native plugin modules in one graph.
 */
@Module({
  imports: [ConfigModule, CatalogModule, PluginsModule, metricsModule],
  controllers: [ParametersController],
})
export class AppModule {}
