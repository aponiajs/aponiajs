import { Module } from "@aponiajs/common";
import { RequestController } from "./request.controller.ts";

/** Every parameter decorator, injecting one piece of the request at a time. */
@Module({ controllers: [RequestController] })
export class AppModule {}
