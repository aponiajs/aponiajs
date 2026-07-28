import { Module } from "@aponiajs/common";
import { CatalogModule } from "../02-modules/catalog.module.ts";
import { ValidationController } from "./validation.controller.ts";

@Module({
  imports: [CatalogModule],
  controllers: [ValidationController],
})
export class ValidationModule {}
