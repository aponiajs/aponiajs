import { Module } from "@aponiajs/common";
import { AppController } from "./app.controller.ts";
import { AppService } from "./app.service.ts";

@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
