import { Controller, Ctx, Get, Store } from "@aponiajs/common";
import { type ElysiaRouteContext, type ElysiaStore } from "@aponiajs/platform-elysia";
import { clock } from "./clock.plugin.ts";

/**
 * Reading what a native plugin adds. The plugin type is named explicitly,
 * because compiling a controller erases its module imports.
 */
@Controller("plugins")
export class PluginContextController {
  @Get()
  read(
    @Ctx() context: ElysiaRouteContext<clock>,
    @Store() store: ElysiaStore<clock>,
  ): {
    now: string;
    traceId: string;
    scope: string;
    requests: number;
  } {
    store.requests += 1;
    return {
      now: context.now(),
      traceId: context.traceId,
      scope: context.scope,
      requests: store.requests,
    };
  }

  @Get("plugin-local")
  readPluginLocal(@Ctx() context: ElysiaRouteContext<clock>): { pluginOnly: string | null } {
    const value = (context as Record<string, unknown>).pluginOnly;

    return { pluginOnly: typeof value === "string" ? value : null };
  }

  @Get("budget")
  readBudget(@Ctx() context: ElysiaRouteContext): { budget: unknown } {
    return { budget: (context as Record<string, unknown>).budget ?? null };
  }
}
