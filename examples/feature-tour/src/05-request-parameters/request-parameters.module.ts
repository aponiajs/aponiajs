import { Module } from "@aponiajs/common";
import { RequestParametersController } from "./request-parameters.controller.ts";

@Module({ controllers: [RequestParametersController] })
export class RequestParametersModule {}
