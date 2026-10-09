import { describe, expect, test } from "bun:test";
import { analyzeControllerRoutes } from "../src/index.ts";

describe("analyzeControllerRoutes", () => {
  test("reads a controller's routes in declaration order with their parameter bindings", () => {
    const source = `import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post("/")
  create(@Body() input: CreateUser) {
    return this.usersService.create(input);
  }

  @Get()
  findAll(@Query() query: ListQuery) {
    return this.usersService.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() input: UpdateUser) {
    return this.usersService.update(id, input);
  }

  @Delete(":id")
  remove(@Param() params: UserParams) {
    return this.usersService.remove(params.id);
  }
}
`;

    expect(analyzeControllerRoutes(source, "users.controller.ts")).toStrictEqual([
      {
        className: "UsersController",
        path: "users",
        routes: [
          {
            method: "POST",
            path: "/",
            methodName: "create",
            promiseCapable: false,
            declaresParameters: true,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [{ index: 0, kind: "body", property: undefined }],
          },
          {
            method: "GET",
            path: "",
            methodName: "findAll",
            promiseCapable: false,
            declaresParameters: true,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [{ index: 0, kind: "query", property: undefined }],
          },
          {
            method: "GET",
            path: ":id",
            methodName: "findOne",
            promiseCapable: false,
            declaresParameters: true,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [{ index: 0, kind: "params", property: "id" }],
          },
          {
            method: "PATCH",
            path: ":id",
            methodName: "update",
            promiseCapable: false,
            declaresParameters: true,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [
              { index: 0, kind: "params", property: "id" },
              { index: 1, kind: "body", property: undefined },
            ],
          },
          {
            method: "DELETE",
            path: ":id",
            methodName: "remove",
            promiseCapable: false,
            declaresParameters: true,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [{ index: 0, kind: "params", property: undefined }],
          },
        ],
      },
    ]);
  });

  test("reads omitted, path-only, schema-only, and path-plus-schema decorator arguments", () => {
    const source = `import { Controller, Get, Post } from "@aponiajs/common";

@Controller()
export class FormsController {
  @Get()
  omitted() {}

  @Get("explicit")
  pathOnly() {}

  @Get({ body: CreateUser })
  schemaOnly() {}

  @Post("/", { body: CreateUser })
  pathAndSchema() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "forms.controller.ts");

    expect(controller?.path).toBe("");
    expect(controller?.routes.map((route) => [route.method, route.path])).toStrictEqual([
      ["GET", ""],
      ["GET", "explicit"],
      ["GET", ""],
      ["POST", "/"],
    ]);
  });

  test("maps every supported parameter decorator to its binding kind", () => {
    const source = `import { Body, Controller, Cookie, Context, Headers, HttpStatus, Param, Post, Query, Req, ResponseSettings, State } from "@aponiajs/common";

@Controller("bindings")
export class BindingsController {
  @Post()
  handle(
    @Body() body: unknown,
    @Body("name") name: string,
    @Query() query: unknown,
    @Query("page") page: string,
    @Param() params: unknown,
    @Param("id") id: string,
    @Headers() headers: unknown,
    @Headers("authorization") authorization: string,
    @Cookie() cookie: unknown,
    @Cookie("session") session: string,
    @State() store: unknown,
    @Context() context: unknown,
    @Req() request: Request,
    @ResponseSettings() set: unknown,
    @HttpStatus() status: unknown,
  ) {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "bindings.controller.ts");

    expect(controller?.routes[0]?.parameters.map((parameter) => parameter.kind)).toStrictEqual([
      "body",
      "body",
      "query",
      "query",
      "params",
      "params",
      "headers",
      "headers",
      "cookie",
      "cookie",
      "store",
      "context",
      "request",
      "set",
      "status",
    ]);
    expect(controller?.routes[0]?.parameters.map((parameter) => parameter.property)).toStrictEqual([
      undefined,
      "name",
      undefined,
      "page",
      undefined,
      "id",
      undefined,
      "authorization",
      undefined,
      "session",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("orders parameter bindings by the index of the parameter they decorate", () => {
    // A parameter's index comes from its position in the declaration, not from
    // the order decorators happen to be recorded in, so undecorated parameters
    // leave gaps and repeated decorators share an index.
    const source = `import { Body, Controller, Get, Param, Query, Req } from "@aponiajs/common";

@Controller("indexed")
export class IndexedController {
  @Get(":id")
  handle(
    @Req() request: Request,
    @Query() @Body("query") first: unknown,
    skipped: string,
    @Param("id") id: string,
  ) {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "indexed.controller.ts");

    expect(controller?.routes[0]?.parameters).toStrictEqual([
      { index: 0, kind: "request", property: undefined },
      { index: 1, kind: "query", property: undefined },
      { index: 1, kind: "body", property: "query" },
      { index: 3, kind: "params", property: "id" },
    ]);
  });

  test("returns a controller without routes when no method declares an HTTP method decorator", () => {
    const source = `import { Body, Controller } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  describe(@Body() input: unknown): string {
    return String(input);
  }
}
`;

    expect(analyzeControllerRoutes(source, "users.controller.ts")).toStrictEqual([
      { className: "UsersController", path: "users", routes: [] },
    ]);
  });

  test("analyzes every controller class in one file in declaration order", () => {
    const source = `import { Controller, Get } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Get()
  findAll() {}
}

@Controller("health")
export class HealthController {
  @Get("live")
  live() {}
}
`;

    const controllers = analyzeControllerRoutes(source, "controllers.ts");

    expect(controllers.map((controller) => controller.className)).toStrictEqual([
      "UsersController",
      "HealthController",
    ]);
    expect(controllers.map((controller) => controller.path)).toStrictEqual(["users", "health"]);
    expect(controllers.map((controller) => controller.routes.length)).toStrictEqual([1, 1]);
  });

  test("names an anonymous default-exported controller with an empty class name", () => {
    const source = `import { Controller, Get } from "@aponiajs/common";

@Controller("anonymous")
export default class {
  @Get()
  findAll() {}
}
`;

    expect(analyzeControllerRoutes(source, "anonymous.controller.ts")).toStrictEqual([
      {
        className: "",
        path: "anonymous",
        routes: [
          {
            method: "GET",
            path: "",
            methodName: "findAll",
            promiseCapable: false,
            declaresParameters: false,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [],
          },
        ],
      },
    ]);
  });

  test("ignores classes that are not decorated with @Controller", () => {
    const source = `import { Controller, Get, Injectable } from "@aponiajs/common";

@Injectable()
export class UsersService {
  @Get()
  findAll() {}
}

@Controller("users")
export class UsersController {
  @Get()
  findAll() {}
}
`;

    expect(analyzeControllerRoutes(source, "users.controller.ts")).toStrictEqual([
      {
        className: "UsersController",
        path: "users",
        routes: [
          {
            method: "GET",
            path: "",
            methodName: "findAll",
            promiseCapable: false,
            declaresParameters: false,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [],
          },
        ],
      },
    ]);
  });

  test("marks async and Promise-returning handlers promise-capable and other handlers not", () => {
    const source = `import { Controller, Get } from "@aponiajs/common";

@Controller("promises")
export class PromisesController {
  @Get("async")
  async asyncHandler() {}

  @Get("annotated")
  annotatedHandler(): Promise<string> {
    return Promise.resolve("done");
  }

  @Get("plain")
  plainHandler(): string {
    return "done";
  }

  @Get("unannotated")
  unannotatedHandler() {
    return "done";
  }
}
`;

    const [controller] = analyzeControllerRoutes(source, "promises.controller.ts");

    expect(
      controller?.routes.map((route) => [route.methodName, route.promiseCapable]),
    ).toStrictEqual([
      ["asyncHandler", true],
      ["annotatedHandler", true],
      ["plainHandler", false],
      ["unannotatedHandler", false],
    ]);
  });

  test("reports one route per HTTP method decorator on a method", () => {
    const source = `import { Controller, Get, Post } from "@aponiajs/common";

@Controller("aliases")
export class AliasesController {
  @Get()
  @Post()
  handle() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "aliases.controller.ts");

    expect(controller?.routes).toStrictEqual([
      {
        method: "GET",
        path: "",
        methodName: "handle",
        promiseCapable: false,
        declaresParameters: false,
        usesArgumentsObject: false,
        declaresSynchronousReturn: false,
        schema: undefined,
        enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
        parameters: [],
      },
      {
        method: "POST",
        path: "",
        methodName: "handle",
        promiseCapable: false,
        declaresParameters: false,
        usesArgumentsObject: false,
        declaresSynchronousReturn: false,
        schema: undefined,
        enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
        parameters: [],
      },
    ]);
  });

  test("ignores a same-named decorator imported from another package", () => {
    const source = `import { Controller, Get, Param } from "@nestjs/common";

@Controller("users")
export class UsersController {
  @Get(":id")
  findOne(@Param("id") id: string) {}
}
`;

    expect(analyzeControllerRoutes(source, "users.controller.ts")).toStrictEqual([]);
  });

  test("recognizes decorators imported under an alias or through a namespace import", () => {
    const aliased = `import { Controller as RestController, Get as ReadRoute } from "@aponiajs/common";

@RestController("aliased")
export class AliasedController {
  @ReadRoute(":id")
  findOne() {}
}
`;
    const namespaced = `import * as aponia from "@aponiajs/common";

@aponia.Controller("namespaced")
export class NamespacedController {
  @aponia.Get()
  findAll(@aponia.Query() query: unknown) {}
}
`;

    expect(analyzeControllerRoutes(aliased, "aliased.controller.ts")).toStrictEqual([
      {
        className: "AliasedController",
        path: "aliased",
        routes: [
          {
            method: "GET",
            path: ":id",
            methodName: "findOne",
            promiseCapable: false,
            declaresParameters: false,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [],
          },
        ],
      },
    ]);
    expect(analyzeControllerRoutes(namespaced, "namespaced.controller.ts")).toStrictEqual([
      {
        className: "NamespacedController",
        path: "namespaced",
        routes: [
          {
            method: "GET",
            path: "",
            methodName: "findAll",
            promiseCapable: false,
            declaresParameters: true,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [{ index: 0, kind: "query", property: undefined }],
          },
        ],
      },
    ]);
  });

  test("ignores decorator call shapes that no Aponia decorator produces", () => {
    const source = `import { Controller, Get } from "@aponiajs/common";
import { helpers } from "./helpers.ts";

@Controller("shapes")
export class ShapesController {
  @(Get)()
  parenthesized() {}

  @helpers.Get()
  memberCall() {}

  @Get
  bare() {}
}
`;

    expect(analyzeControllerRoutes(source, "shapes.controller.ts")).toStrictEqual([
      { className: "ShapesController", path: "shapes", routes: [] },
    ]);
  });

  test("ignores parameter decorators that are not imported from @aponiajs/common", () => {
    const source = `import { Controller, Get } from "@aponiajs/common";
import { Body, Query } from "./local-decorators.ts";

@Controller("mixed")
export class MixedController {
  @Get()
  handle(@Body() body: unknown, @Query("page") page: string) {}
}
`;

    expect(analyzeControllerRoutes(source, "mixed.controller.ts")).toStrictEqual([
      {
        className: "MixedController",
        path: "mixed",
        routes: [
          {
            method: "GET",
            path: "",
            methodName: "handle",
            promiseCapable: false,
            declaresParameters: true,
            usesArgumentsObject: false,
            declaresSynchronousReturn: false,
            schema: undefined,
            enhancers: { guards: [], interceptors: [], filters: [], unreadable: undefined },
            parameters: [],
          },
        ],
      },
    ]);
  });

  test("returns no controllers for a file that does not import @aponiajs/common", () => {
    const source = `@Controller("users")
export class UsersController {
  @Get()
  findAll(@Query() query: unknown) {}
}
`;

    expect(analyzeControllerRoutes(source, "users.controller.ts")).toStrictEqual([]);
  });

  test("returns frozen results that are identical across repeated analyses", () => {
    const source = `import { Body, Controller, Post } from "@aponiajs/common";

@Controller("notes")
export class NotesController {
  @Post("/")
  create(@Body("title") title: string) {}
}
`;
    const [first] = analyzeControllerRoutes(source, "notes.controller.ts");
    const [second] = analyzeControllerRoutes(source, "notes.controller.ts");

    expect(second).toStrictEqual(first);
    expect(second).not.toBe(first);
    expect(first?.routes).not.toBe(second?.routes);

    const [binding] = first?.routes[0]?.parameters ?? [];
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.routes)).toBe(true);
    expect(Object.isFrozen(first?.routes[0])).toBe(true);
    expect(Object.isFrozen(first?.routes[0]?.parameters)).toBe(true);
    expect(Object.isFrozen(binding)).toBe(true);
  });

  test("reads every schema slot as the expression the decorator wrote", () => {
    const source = `import { Controller, Get, Post } from "@aponiajs/common";
import { t } from "elysia";
import { CreateUser, ListUsers, ResponseMap, RouteParams, UserHeaders, UserCookies } from "./users.model.ts";

@Controller("users")
export class UsersController {
  @Post("/", {
    headers: UserHeaders,
    params: RouteParams,
    response: { 201: ResponseMap },
    cookie: UserCookies,
    query: t.Object({ page: t.String() }),
    body: CreateUser,
  })
  create() {}

  @Get({ query: ListUsers })
  list() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");
    const [create, list] = controller?.routes ?? [];

    // The slots come back in the framework's order, not the order the options
    // object wrote them in, and each value is the source text verbatim: a
    // validation model by class name, an inline validator by its own text, and a
    // status-keyed response map by the object literal that declares it.
    expect(create?.schema?.slots).toStrictEqual([
      { slot: "body", expression: "CreateUser", unreadable: undefined },
      { slot: "query", expression: "t.Object({ page: t.String() })", unreadable: undefined },
      { slot: "params", expression: "RouteParams", unreadable: undefined },
      { slot: "headers", expression: "UserHeaders", unreadable: undefined },
      { slot: "cookie", expression: "UserCookies", unreadable: undefined },
      { slot: "response", expression: "{ 201: ResponseMap }", unreadable: undefined },
    ]);
    expect(create?.schema?.unreadable).toBeUndefined();
    expect(list?.schema?.slots).toStrictEqual([
      { slot: "query", expression: "ListUsers", unreadable: undefined },
    ]);
  });

  test("reads a schema slot declared as an inline validator and a slot declared twice", () => {
    const source = `import { Controller, Post } from "@aponiajs/common";
import { t } from "elysia";

@Controller("notes")
export class NotesController {
  @Post("/", { body: t.Object({ title: t.String({ minLength: 1 }) }), body: t.Object({}) })
  create() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "notes.controller.ts");

    // The last declaration of a slot wins, because that is the value the runtime
    // reads from the same object literal.
    expect(controller?.routes[0]?.schema?.slots).toStrictEqual([
      { slot: "body", expression: "t.Object({})", unreadable: undefined },
    ]);
  });

  test("reports a schema slot that cannot be read, keeping the slots that can", () => {
    const source = `import { Controller, Get, Post, Put } from "@aponiajs/common";
import { extraSlots } from "./users.model.ts";
import { CreateUser } from "./users.model.ts";

@Controller("users")
export class UsersController {
  @Post("/", { ...extraSlots, body: CreateUser })
  spread() {}

  @Post("/", { [slotName]: CreateUser })
  computed() {}

  @Post("/", { body: CreateUser, query() {} })
  method() {}

  @Post("/", { body: CreateUser, query: })
  missingValue() {}

  @Put("/", { body: CreateUser, query: Missing })
  missingName() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");
    const [spread, computed, method, missingValue, missingName] = controller?.routes ?? [];

    expect(spread?.schema?.unreadable).toBe(
      "@Post in users.controller.ts spreads its schema, which may declare slots this analysis cannot read.",
    );
    // The slots that were read before the spread are still reported.
    expect(spread?.schema?.slots).toStrictEqual([
      { slot: "body", expression: "CreateUser", unreadable: undefined },
    ]);
    expect(computed?.schema?.slots).toStrictEqual([]);
    expect(computed?.schema?.unreadable).toBe(
      "@Post in users.controller.ts declares a schema slot this analysis cannot read statically.",
    );
    expect(method?.schema?.slots).toStrictEqual([
      { slot: "body", expression: "CreateUser", unreadable: undefined },
    ]);
    expect(method?.schema?.unreadable).toBe(
      "@Post in users.controller.ts declares a schema slot this analysis cannot read statically.",
    );
    expect(missingValue?.schema?.slots).toStrictEqual([
      { slot: "body", expression: "CreateUser", unreadable: undefined },
    ]);
    expect(missingValue?.schema?.unreadable).toBe(
      '@Post in users.controller.ts declares its "query" schema slot with no value.',
    );
    expect(missingName?.schema?.unreadable).toBe(
      '@Put in users.controller.ts\'s "query" schema reads "Missing", which is not an import or an export of the file it was written in, so a generated module cannot name it.',
    );
    expect(missingName?.schema?.slots[1]?.unreadable).toBe(missingName?.schema?.unreadable);
  });

  test("reports a schema argument that is not an object literal", () => {
    const source = `import { Controller, Post } from "@aponiajs/common";

const schema = { body: CreateUser };

@Controller("users")
export class UsersController {
  @Post("/", schema)
  create() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");

    expect(controller?.routes[0]?.schema?.unreadable).toBe(
      "@Post in users.controller.ts must declare its schema as an object literal to be read statically.",
    );
    expect(controller?.routes[0]?.schema?.slots).toStrictEqual([]);
  });

  test("throws when a decorator argument cannot be read statically", () => {
    const dynamicPath = `import { Controller } from "@aponiajs/common";

@Controller(controllerPath)
export class UsersController {}
`;
    const dynamicRoutePath = `import { Controller, Get } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Get(routePath)
  findAll() {}
}
`;
    const extraControllerArgument = `import { Controller } from "@aponiajs/common";

@Controller("users", "extra")
export class UsersController {}
`;
    const extraRouteArgument = `import { Controller, Get } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Get("/", { body: CreateUser }, { query: ListQuery })
  create() {}
}
`;
    const extraPropertyArgument = `import { Body, Controller, Post } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Post()
  create(@Body("title", "ignored") title: string) {}
}
`;

    expect(() => analyzeControllerRoutes(dynamicPath, "users.controller.ts")).toThrow(
      "@Controller in users.controller.ts must declare a string literal to be read statically.",
    );
    expect(() => analyzeControllerRoutes(dynamicRoutePath, "users.controller.ts")).toThrow(
      "@Get in users.controller.ts must declare a string literal to be read statically.",
    );
    expect(() => analyzeControllerRoutes(extraControllerArgument, "users.controller.ts")).toThrow(
      "@Controller in users.controller.ts must declare at most one path argument.",
    );
    expect(() => analyzeControllerRoutes(extraRouteArgument, "users.controller.ts")).toThrow(
      "@Get in users.controller.ts must declare at most a path and a schema.",
    );
    expect(() => analyzeControllerRoutes(extraPropertyArgument, "users.controller.ts")).toThrow(
      "@Body in users.controller.ts must declare at most one property name.",
    );
  });

  test("throws when a parameter decorator decorates anything but a method parameter", () => {
    const constructorParameter = `import { Body, Controller } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  constructor(@Body() input: unknown) {}
}
`;
    const propertyDecorator = `import { Controller, Query } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Query("page")
  readonly page: string = "1";
}
`;

    expect(() => analyzeControllerRoutes(constructorParameter, "users.controller.ts")).toThrow(
      "@Body in users.controller.ts can only decorate a route handler parameter.",
    );
    expect(() => analyzeControllerRoutes(propertyDecorator, "users.controller.ts")).toThrow(
      "@Query in users.controller.ts can only decorate a route handler parameter.",
    );
  });

  test("reads the enhancers a controller class declares at class scope", () => {
    const source = `import { Controller, Get, UseGuards, UseInterceptors } from "@aponiajs/common";

@UseInterceptors(LoggingInterceptor)
@UseGuards(AuthGuard)
@Controller("users")
export class UsersController {
  @Get()
  findAll() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");

    // Both kinds are declared on the class, so both reach every route it
    // declares; the interceptors merge nothing here either.
    expect(controller?.routes[0]?.enhancers).toStrictEqual({
      guards: ["AuthGuard"],
      interceptors: ["LoggingInterceptor"],
      filters: [],
      unreadable: undefined,
    });
  });

  test("reads the enhancers a handler declares at method scope", () => {
    const source = `import { Controller, Get, UseFilters, UseGuards } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @UseFilters(NotFoundFilter)
  @UseGuards(AuthGuard)
  @Get(":id")
  findOne() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");

    expect(controller?.routes[0]?.enhancers).toStrictEqual({
      guards: ["AuthGuard"],
      interceptors: [],
      filters: ["NotFoundFilter"],
      unreadable: undefined,
    });
  });

  test("joins class scope and method scope in the order the runtime runs them", () => {
    const source = `import { Controller, Get, UseFilters, UseGuards, UseInterceptors } from "@aponiajs/common";

@UseFilters(ClassFilter)
@UseInterceptors(ClassInterceptor)
@UseGuards(ClassGuard)
@Controller("users")
export class UsersController {
  @UseFilters(MethodFilter)
  @UseInterceptors(MethodInterceptor)
  @UseGuards(MethodGuard)
  @Get()
  findAll() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");

    // Guards and interceptors run outward-in, so the class's own declarations
    // come first; filters run most-specific-first, so the handler's come first.
    // This is the order `mergeEnhancerMetadata` in the platform's
    // `route-compiler.ts` produces for the same source.
    expect(controller?.routes[0]?.enhancers).toStrictEqual({
      guards: ["ClassGuard", "MethodGuard"],
      interceptors: ["ClassInterceptor", "MethodInterceptor"],
      filters: ["MethodFilter", "ClassFilter"],
      unreadable: undefined,
    });
  });

  test("records a stacked declaration in the order the decorators were applied", () => {
    const source = `import { Controller, Get, UseGuards } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @UseGuards(OuterGuard)
  @UseGuards(InnerGuard)
  @Get()
  findAll() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");

    // Decorators are applied bottom-up, and each application appends its
    // entries, so the runtime records `InnerGuard` before `OuterGuard`.
    expect(controller?.routes[0]?.enhancers.guards).toStrictEqual(["InnerGuard", "OuterGuard"]);
  });

  test("recognizes enhancer decorators imported under an alias or through a namespace import", () => {
    const aliased = `import { Controller, Get, UseGuards as Guard } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Guard(AuthGuard)
  @Get()
  findAll() {}
}
`;
    const namespaced = `import * as aponia from "@aponiajs/common";

@aponia.Controller("users")
export class UsersController {
  @aponia.UseGuards(AuthGuard)
  @aponia.Get()
  findAll() {}
}
`;

    expect(
      analyzeControllerRoutes(aliased, "aliased.controller.ts")[0]?.routes[0]?.enhancers.guards,
    ).toStrictEqual(["AuthGuard"]);
    expect(
      analyzeControllerRoutes(namespaced, "namespaced.controller.ts")[0]?.routes[0]?.enhancers
        .guards,
    ).toStrictEqual(["AuthGuard"]);
  });

  test("ignores a same-named enhancer decorator imported from another package", () => {
    const source = `import { Controller, Get } from "@aponiajs/common";
import { UseGuards } from "./local-decorators.ts";

@Controller("users")
export class UsersController {
  @UseGuards(LocalGuard)
  @Get()
  findAll() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");

    // The local `UseGuards` is not Aponia's, so nothing is declared — which is
    // what keeps a generated route from naming a class the runtime never ran.
    expect(controller?.routes[0]?.enhancers).toStrictEqual({
      guards: [],
      interceptors: [],
      filters: [],
      unreadable: undefined,
    });
  });

  test("reports an enhancer argument that is not a class reference", () => {
    const source = `import { Controller, Get, UseGuards } from "@aponiajs/common";
import { readGuards } from "./guards.ts";

@Controller("users")
export class UsersController {
  @UseGuards(...readGuards())
  @Get()
  findAll() {}
}
`;

    const [controller] = analyzeControllerRoutes(source, "users.controller.ts");

    // The declaration is reported rather than dropped, so a consumer declines
    // the route instead of emitting one that runs fewer guards.
    expect(controller?.routes[0]?.enhancers.unreadable).toBe(
      "@UseGuards in users.controller.ts must name each enhancer with a class reference to be read statically.",
    );
    expect(controller?.routes[0]?.enhancers.guards).toStrictEqual([]);
  });
});

test("reports whether a handler declares parameters and whether it reads arguments", () => {
  const source = `import { Controller, Get } from "@aponiajs/common";

@Controller("facts")
export class FactsController {
  @Get("bare")
  bare() {}

  @Get("declared")
  declared(first: string) {}

  @Get("legacy")
  legacy() {
    return arguments.length;
  }

  @Get("property")
  property(value: { arguments: number }) {
    return value.arguments;
  }
}
`;

  const routes = analyzeControllerRoutes(source, "facts.controller.ts")[0]?.routes ?? [];

  // The runtime gives a handler that declares a parameter the whole context and
  // one that reads `arguments` the context too, so both facts have to survive
  // analysis without either being mistaken for a property named `arguments`.
  expect(
    routes.map((route) => [route.methodName, route.declaresParameters, route.usesArgumentsObject]),
  ).toEqual([
    ["bare", false, false],
    ["declared", true, false],
    ["legacy", false, true],
    ["property", true, false],
  ]);
});
