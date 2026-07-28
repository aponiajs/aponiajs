import { Controller, Ctx, Get } from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { clock } from "./clock.plugin.ts";

/**
 * Use case 06 — reading what a native plugin adds. The plugin type is named
 * explicitly, because compiling a controller erases its module imports.
 */
@Controller("plugins")
export class PluginContextController {
  @Get()
  read(@Ctx() context: ElysiaRouteContext<clock>): {
    now: string;
    traceId: string;
    scope: string;
    requests: number;
  } {
    context.store.requests += 1;
    return {
      now: context.now(),
      traceId: context.traceId,
      scope: context.scope,
      requests: context.store.requests,
    };
  }

  @Get("plugin-local")
  readPluginLocal(@Ctx() context: ElysiaRouteContext<clock>): { pluginOnly: string | null } {
    const value = (context as Record<string, unknown>).pluginOnly;

    return { pluginOnly: value === undefined ? null : String(value) };
  }

  @Get("budget")
  readBudget(@Ctx() context: ElysiaRouteContext): { budget: unknown } {
    return { budget: (context as Record<string, unknown>).budget ?? null };
  }
}
