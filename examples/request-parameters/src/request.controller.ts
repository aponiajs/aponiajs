import {
  Body,
  Controller,
  Cookie,
  Ctx,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  type RouteResponseSettings,
} from "@aponiajs/common";
import { type ElysiaRouteContext } from "@aponiajs/platform-elysia";
import { createItemSchema, type CreateItem } from "./item.schema.ts";

/**
 * Every parameter decorator, both whole and named. A decorator with a name
 * selects one property; without one it injects the whole part.
 */
@Controller("parameters")
export class RequestController {
  @Post("body", createItemSchema)
  readBody(
    @Body() body: CreateItem,
    @Body("name") name: string,
  ): { body: CreateItem; name: string } {
    return { body, name };
  }

  @Get("query")
  readQuery(
    @Query() query: Record<string, string>,
    @Query("term") term: string | undefined,
  ): { query: Record<string, string>; term: string | undefined } {
    return { query, term };
  }

  @Get("params/:id")
  readParams(
    @Param("id") id: string,
    @Param() params: Record<string, string>,
  ): {
    id: string;
    params: Record<string, string>;
  } {
    return { id, params };
  }

  @Get("headers")
  readHeaders(@Headers("x-tenant") tenant: string | undefined): { tenant: string | null } {
    return { tenant: tenant ?? null };
  }

  @Get("cookies")
  readCookies(@Cookie("session") session: unknown): { session: string | null } {
    return { session: session === undefined ? null : String(session) };
  }

  @Get("request")
  readRequest(@Req() request: Request): { method: string; path: string } {
    return { method: request.method, path: new URL(request.url).pathname };
  }

  @Get("response")
  writeResponse(@Res() response: RouteResponseSettings): { written: boolean } {
    response.headers["x-source"] = "parameters";
    return { written: true };
  }

  @Get("context")
  readContext(@Ctx() context: ElysiaRouteContext): { path: string } {
    return { path: context.path };
  }

  @Get("whole-context")
  readWholeContext(context: ElysiaRouteContext): { path: string } {
    return { path: context.path };
  }
}
