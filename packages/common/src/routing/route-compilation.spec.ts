import { describe, expect, test } from "bun:test";
import { Controller, Get, Injectable } from "../decorators/decorators.ts";
import { Header, HttpCode } from "./response-metadata.ts";
import { Serialize } from "./response-serializer.ts";
import { Sse } from "./sse.ts";
import { UseFilters, UseGuards } from "../enhancers/enhancer.decorator.ts";
import { UsePipes } from "../pipes/pipe.decorator.ts";
import { Version } from "./versioning.ts";
import { type CanActivate, type ExceptionFilter } from "../interfaces/enhancer.interface.ts";
import { type PipeTransform } from "../interfaces/pipe.interface.ts";
import { compileRoutes } from "../index.ts";

@Injectable()
class ClassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class MethodGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class ClassFilter implements ExceptionFilter {
  catch(): void {}
}

@Injectable()
class MethodFilter implements ExceptionFilter {
  catch(): void {}
}

@Injectable()
class ClassPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}

@Injectable()
class MethodPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return value;
  }
}

const serialize = (value: unknown): unknown => value;

@Controller("users")
@UseGuards(ClassGuard)
@UseFilters(ClassFilter)
@UsePipes(ClassPipe)
class UsersController {
  @Get(":id")
  @UseGuards(MethodGuard)
  @UseFilters(MethodFilter)
  @UsePipes(MethodPipe)
  @Header("x-user", "declared")
  @HttpCode(201)
  @Serialize(serialize)
  find(): string {
    return "user";
  }

  @Get(":id/events")
  @Version("2")
  @Sse()
  events(): string {
    return "event";
  }
}

describe("compileRoutes", () => {
  const routes = compileRoutes(UsersController, "/users");

  test("joins the controller path, the route path, and a version prefix", () => {
    expect(routes.map((route) => route.path)).toEqual(["/users/:id", "/v2/users/:id/events"]);
    expect(routes[1]?.version).toBe("2");
  });

  test("keeps guards and interceptors outward-in and filters most-specific-first", () => {
    expect(routes[0]?.enhancers.guards).toEqual([ClassGuard, MethodGuard]);
    expect(routes[0]?.enhancers.filters).toEqual([MethodFilter, ClassFilter]);
    expect(routes[0]?.pipes).toEqual([ClassPipe, MethodPipe]);
  });

  test("carries the declarations a runtime applies to the answer", () => {
    expect(routes[0]?.responseHeaders).toEqual({ "x-user": "declared" });
    expect(routes[0]?.httpCode).toBe(201);
    expect(routes[0]?.serializer).toBe(serialize);
    expect(routes[1]?.sse).toBe(true);
  });

  test("refuses nothing: a controller with no route decorator compiles to an empty plan", () => {
    @Controller("health")
    class HealthController {}

    expect(compileRoutes(HealthController, "/health")).toEqual([]);
  });
});
