import { Module } from "@aponiajs/common";
import { ViewModule } from "@aponiajs/view";
import { AppController } from "./app.controller.ts";

@Module({
  imports: [
    ViewModule.register({
      defaultEngine: "blade",
      rootDir: new URL("../views", import.meta.url).pathname,
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
