import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

/**
 * The endpoint policy, read from the environment once at boot.
 *
 * The declaration carries data only. The server, and the token check, are live
 * values and stay in the module registration.
 */
export const McpConfig = defineConfiguration(
  z
    .object({
      MCP_PATH: z.string().default("/mcp"),
      MCP_ALLOWED_ORIGINS: z.string().default(""),
      MCP_ALLOW_UNAUTHENTICATED: z.enum(["true", "false"]).default("false"),
    })
    .transform(({ MCP_PATH, MCP_ALLOWED_ORIGINS, MCP_ALLOW_UNAUTHENTICATED }) => ({
      path: MCP_PATH,
      allowedOrigins: MCP_ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
      allowUnauthenticated: MCP_ALLOW_UNAUTHENTICATED === "true",
    })),
  "mcp.config",
);
