import { Module } from "@aponiajs/common";
import { ItemController } from "./item.controller.ts";
import { ItemStore } from "./item.store.ts";

/**
 * Route validation. Every route here declares a schema, so a bad request
 * answers 422 without reaching the handler.
 */
@Module({ controllers: [ItemController], providers: [ItemStore] })
export class AppModule {}
