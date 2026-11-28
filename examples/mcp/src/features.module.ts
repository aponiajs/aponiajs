import { Module } from "@aponiajs/common";
import { AppService } from "./app.service.ts";

/** The providers the MCP endpoint injects. */
@Module({
  providers: [AppService],
  exports: [AppService],
})
export class FeaturesModule {}
