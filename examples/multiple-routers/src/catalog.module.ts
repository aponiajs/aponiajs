import { Module } from "@aponiajs/common";
import { CatalogService } from "./catalog.service.ts";

/** A feature module that exports its service to the routers that need it. */
@Module({
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
