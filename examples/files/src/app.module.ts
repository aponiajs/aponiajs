import { Module } from "@aponiajs/common";
import { FilesController } from "./files.controller.ts";

@Module({ controllers: [FilesController] })
export class AppModule {}
