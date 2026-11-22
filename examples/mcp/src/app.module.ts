import { Module } from "@aponiajs/common";
import { McpModule } from "@aponiajs/mcp";
import { AppService } from "./app.service.ts";
import { McpConfig } from "./config.ts";
import { FeaturesModule } from "./features.module.ts";
import { buildMcpServer } from "./mcp-server.ts";

const mcp = McpModule.register({
  configuration: McpConfig,
  imports: [FeaturesModule],
  inject: [AppService],
  useFactory: (app) => () => buildMcpServer(app),
  authorize: (request) => {
    const token = Bun.env.MCP_TOKEN ?? "aponia-example-token";
    return token.length > 0 && request.headers.get("authorization") === `Bearer ${token}`;
  },
  jsonResponse: true,
});

/** The example application: one feature module and one MCP endpoint. */
@Module({
  imports: [FeaturesModule, mcp],
})
export class AppModule {}
