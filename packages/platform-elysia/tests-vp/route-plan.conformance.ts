import {
  defineModule,
  provideClass,
  type ClassToken,
  type RouteParameterMetadata,
} from "@aponiajs/common";
import { z } from "zod";
import { AponiaFactory, defineElysiaControllerRoutes, type ElysiaRoutePlan } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

class ConformanceDeclaredService {
  tag(): string {
    return "service";
  }
}

class ConformanceDeclaredController {
  readonly #service: ConformanceDeclaredService;

  constructor(service: ConformanceDeclaredService) {
    this.#service = service;
  }

  read(id: string): string {
    return `read:${id}`;
  }

  create(body: { name: string }): string {
    return `created:${body.name}`;
  }

  ping(): string {
    return this.#service.tag();
  }
}

const conformanceRoutes: readonly ElysiaRoutePlan[] = [
  {
    method: "GET",
    path: ":id",
    propertyKey: "read",
    parameters: [{ index: 0, kind: "params", property: "id" }],
  },
  {
    method: "POST",
    path: "",
    propertyKey: "create",
    parameters: [{ index: 0, kind: "body", property: undefined }],
    schema: { body: z.object({ name: z.string().min(2) }) },
  },
  { method: "GET", path: "ping", propertyKey: "ping" },
];

/**
 * The declared route parameter and the plan itself are the descriptor path's
 * public vocabulary, so the lane asserts both shapes rather than only the
 * behaviour they produce.
 */
type RouteParameterAssertion = Expect<
  Equals<ElysiaRoutePlan["parameters"], readonly RouteParameterMetadata[] | undefined>
>;
type TakesContextAssertion = Expect<Equals<ElysiaRoutePlan["takesContext"], boolean | undefined>>;
type GuardsAssertion = Expect<
  Equals<ElysiaRoutePlan["guards"], readonly ClassToken<unknown>[] | undefined>
>;
type InterceptorsAssertion = Expect<
  Equals<ElysiaRoutePlan["interceptors"], readonly ClassToken<unknown>[] | undefined>
>;
type FiltersAssertion = Expect<
  Equals<ElysiaRoutePlan["filters"], readonly ClassToken<unknown>[] | undefined>
>;

const conformanceModule = defineModule({
  id: "ConformanceDeclaredModule",
  providers: [provideClass(ConformanceDeclaredService, [])],
  controllers: [
    defineElysiaControllerRoutes(ConformanceDeclaredController, {
      path: "/declared",
      inject: [ConformanceDeclaredService],
      routes: conformanceRoutes,
    }),
  ],
});

test("the Vite+ lane types a declared route plan", () => {
  const parametersAssertion: RouteParameterAssertion = true;
  const takesContextAssertion: TakesContextAssertion = true;
  const guardsAssertion: GuardsAssertion = true;
  const interceptorsAssertion: InterceptorsAssertion = true;
  const filtersAssertion: FiltersAssertion = true;

  expect(parametersAssertion).toBe(true);
  expect(takesContextAssertion).toBe(true);
  expect(guardsAssertion).toBe(true);
  expect(interceptorsAssertion).toBe(true);
  expect(filtersAssertion).toBe(true);
});

test("the Vite+ lane serves a controller whose routes were declared as data", async () => {
  const application = await AponiaFactory.create(conformanceModule, { logger: false });

  const read = await application.handle(new Request("http://localhost/declared/7"));
  expect(read.status).toBe(200);
  expect(await read.text()).toBe("read:7");

  const ping = await application.handle(new Request("http://localhost/declared/ping"));
  expect(await ping.text()).toBe("service");

  await application.close();
});

test("the Vite+ lane lowers a declared schema into route validation", async () => {
  const application = await AponiaFactory.create(conformanceModule, { logger: false });
  const post = (body: unknown): Request =>
    new Request("http://localhost/declared", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  expect((await application.handle(post({ name: "Ada" }))).status).toBe(200);
  expect((await application.handle(post({ name: "A" }))).status).toBe(422);

  await application.close();
});

class ConformanceFirstClaim {
  read(): string {
    return "first";
  }
}

class ConformanceSecondClaim {
  read(): string {
    return "second";
  }
}

const conformanceClaimingModule = defineModule({
  id: "ConformanceClaimingModule",
  controllers: [
    defineElysiaControllerRoutes(ConformanceFirstClaim, {
      path: "/claim",
      routes: [{ method: "GET", path: ":id", propertyKey: "read" }],
    }),
    defineElysiaControllerRoutes(ConformanceSecondClaim, {
      path: "/claim",
      routes: [{ method: "GET", path: ":id", propertyKey: "read" }],
    }),
  ],
});

test("the Vite+ lane rejects a route two declared controllers claim", async () => {
  const error = await AponiaFactory.create(conformanceClaimingModule, { logger: false }).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toEqual(
    expect.objectContaining({
      code: "DUPLICATE_ROUTE",
      details: expect.objectContaining({ method: "GET", path: "/claim/:id" }),
    }),
  );
});
