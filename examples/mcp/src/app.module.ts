import { Module } from "@aponiajs/common";
import { McpModule } from "@aponiajs/mcp";
import { ApiKeyGuard } from "./api-key.guard.ts";
import { FeaturesModule } from "./features.module.ts";
import { OrdersTools } from "./orders.tools.ts";

const mcp = McpModule.forRoot({
  name: "aponia-mcp-example",
  version: "1.0.0",
  instructions: "Call add for arithmetic and describe_application for context.",
  guards: [ApiKeyGuard],
});

/** The example application: one feature module and one MCP endpoint. */
@Module({
  imports: [FeaturesModule, mcp],
  providers: [ApiKeyGuard, OrdersTools],
})
export class AppModule {}
