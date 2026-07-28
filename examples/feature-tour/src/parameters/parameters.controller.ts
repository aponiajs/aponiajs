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
import { createItemSchema, type CreateItem } from "../catalog/catalog.schema.ts";

/** Use case: every request parameter decorator, named and unnamed. */
@Controller("parameters")
export class ParametersController {
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
  readParams(@Param("id") id: string): { id: string } {
    return { id };
  }

  @Get("headers")
  readHeaders(@Headers("x-tenant") tenant: string | undefined): { tenant: string | undefined } {
    return { tenant };
  }

  @Get("cookies")
  readCookies(@Cookie("session") session: unknown): { session: unknown } {
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
}
