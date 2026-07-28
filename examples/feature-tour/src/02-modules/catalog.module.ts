import { Module } from "@aponiajs/common";
import { ProvidersModule } from "../01-providers/providers.module.ts";
import { CatalogService } from "./catalog.service.ts";

/**
 * Use case 02 — a feature module importing another module for its exports and
 * re-exporting its own service for the modules that need it.
 */
@Module({
  imports: [ProvidersModule],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
