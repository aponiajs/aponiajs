import { Module } from "@aponiajs/common";
import { UsersController } from "./app.controller.ts";

@Module({ controllers: [UsersController] })
export class AppModule {}
