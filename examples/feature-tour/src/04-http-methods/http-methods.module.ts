import { Module } from "@aponiajs/common";
import { CatalogModule } from "../02-modules/catalog.module.ts";
import { HttpMethodsController } from "./http-methods.controller.ts";

@Module({
  imports: [CatalogModule],
  controllers: [HttpMethodsController],
})
export class HttpMethodsModule {}
