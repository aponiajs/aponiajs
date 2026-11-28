import { Injectable } from "@aponiajs/common";
import { Tool, type McpContext } from "@aponiajs/mcp";
import { z } from "zod";
import { AppService } from "./app.service.ts";

/** The tools the example application publishes. */
@Injectable()
export class OrdersTools {
  constructor(private readonly app: AppService) {}

  /** Adds two numbers the model passes as arguments. */
  @Tool({
    description: "Add two numbers",
    inputSchema: z.object({ a: z.number(), b: z.number() }),
  })
  add({ a, b }: { a: number; b: number }, _context: McpContext): string {
    return String(a + b);
  }

  /** Describes the running application through an injected provider. */
  @Tool({ description: "Describe the running application" })
  describeApplication(_input: unknown, _context: McpContext): string {
    return this.app.describe();
  }
}
