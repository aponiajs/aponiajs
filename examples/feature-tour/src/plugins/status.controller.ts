import { Controller, Ctx, Get } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { clock } from "./clock.plugin.ts";

/**
 * Use case: reading what a native plugin adds, fully typed. The plugin type is
 * named explicitly because compiling a controller erases its module imports.
 */
@Controller("status")
export class StatusController {
  @Get()
  read(@Ctx() context: ElysiaRouteContext<clock>): {
    now: string;
    traceId: string;
    requests: number;
  } {
    context.store.requests += 1;
    return { now: context.now(), traceId: context.traceId, requests: context.store.requests };
  }

  @Get("budget")
  readBudget(@Ctx() context: ElysiaRouteContext): { budget: unknown } {
    return { budget: (context as Record<string, unknown>).budget ?? null };
  }
}
