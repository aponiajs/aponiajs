import { Module } from "@aponiajs/common";
import { ConfigModule } from "../config/config.module.ts";
import { CatalogController } from "./catalog.controller.ts";
import { CatalogService } from "./catalog.service.ts";

/** Use case: a feature module importing another module for its exports. */
@Module({
  imports: [ConfigModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
