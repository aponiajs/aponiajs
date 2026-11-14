import {
  Controller,
  createToken,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import {
  AponiaFactory,
  RequestContextModule,
  RequestContextService,
  type RequestContext,
  type RequestContextModuleOptions,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
type Equals<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<TAssertion extends true> = TAssertion;

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

type RequestContextContractAssertions = [
  Expect<Equals<keyof RequestContext, "request" | "requestId" | "get" | "set">>,
  Expect<Equals<keyof RequestContextModuleOptions, "header" | "generate" | "echo">>,
];

const CONFORMANCE_TOKEN = createToken<string>("conformance.token");

@Injectable()
class ConformanceGuard implements CanActivate {
  readonly #context: RequestContextService;

  constructor(context: RequestContextService) {
    this.#context = context;
  }

  canActivate(_execution: ExecutionContext): boolean {
    this.#context.current()?.set(CONFORMANCE_TOKEN, "conformance-value");
    return true;
  }
}

@Injectable()
class ConformanceService {
  readonly #context: RequestContextService;

  constructor(context: RequestContextService) {
    this.#context = context;
  }

  read() {
    const current = this.#context.current();
    return {
      requestId: current?.requestId,
      tokenValue: current?.get(CONFORMANCE_TOKEN),
      hasRequest: current?.request instanceof Request,
    };
  }
}

@Controller("conformance-context")
class ConformanceController {
  readonly #service: ConformanceService;

  constructor(service: ConformanceService) {
    this.#service = service;
  }

  @Get()
  @UseGuards(ConformanceGuard)
  get() {
    return this.#service.read();
  }
}

@Module({
  imports: [RequestContextModule.forRoot()],
  controllers: [ConformanceController],
  providers: [ConformanceService, ConformanceGuard],
})
class ConformanceModule {}

test("the Vite+ lane validates request context types and runtime reach", async () => {
  const assertions = Array.from({ length: 2 }, () => true) as RequestContextContractAssertions;
  expect(assertions).toHaveLength(2);

  const application = await AponiaFactory.create(ConformanceModule, { logger: false });
  const response = await application.handle(
    new Request("http://localhost/conformance-context", {
      headers: { "x-request-id": "vp-corr-id-1" },
    }),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toBe("vp-corr-id-1");

  const body = (await response.json()) as {
    requestId: string;
    tokenValue: string;
    hasRequest: boolean;
  };

  expect(body.requestId).toBe("vp-corr-id-1");
  expect(body.tokenValue).toBe("conformance-value");
  expect(body.hasRequest).toBe(true);

  await application.close();
});
