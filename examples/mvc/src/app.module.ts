import { Module } from "@aponiajs/common";
import { ViewModule } from "@aponiajs/view";
import { AppController } from "./app.controller.ts";

@Module({
  imports: [ViewModule.register()],
  controllers: [AppController],
})
export class AppModule {}
