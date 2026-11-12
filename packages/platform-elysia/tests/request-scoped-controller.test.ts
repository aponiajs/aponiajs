import { expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  MessagePattern,
  Module,
  createToken,
  defineModule,
  provideValue,
  Scope,
  WebSocketGateway,
} from "@aponiajs/common";
import { AponiaFactory, defineController } from "../src/index.ts";
import { RequestContextModule } from "../src/request-context/request-context-module.ts";
import { RequestContextService } from "../src/request-context/request-context.service.ts";

let serviceInstances = 0;
let controllerInstances = 0;
let bubbledInstances = 0;

@Injectable({ scope: Scope.REQUEST })
class RequestScopedService {
  readonly instance = ++serviceInstances;

  constructor(private readonly context: RequestContextService) {}

  requestId(): string | undefined {
    return this.context.current()?.requestId;
  }
}

@Injectable({ scope: Scope.REQUEST })
@Controller("scoped")
class ScopedController {
  readonly instance = ++controllerInstances;

  constructor(private readonly service: RequestScopedService) {}

  @Get()
  read() {
    return {
      controller: this.instance,
      service: this.service.instance,
      requestId: this.service.requestId(),
    };
  }
}

@Injectable()
class BubbledService {
  readonly instance = ++bubbledInstances;

  constructor(readonly scoped: RequestScopedService) {}
}

@Controller("bubbled")
class BubbledController {
  constructor(private readonly service: BubbledService) {}

  @Get()
  read() {
    return {
      service: this.service.instance,
      scoped: this.service.scoped.instance,
      requestId: this.service.scoped.requestId(),
    };
  }
}

@Module({
  imports: [RequestContextModule.forRoot()],
  controllers: [ScopedController, BubbledController],
  providers: [RequestScopedService, BubbledService],
})
class ScopedAppModule {}

test("constructs one controller and provider instance per request", async () => {
  const application = await AponiaFactory.create(ScopedAppModule, { logger: false });

  const first = await application.handle(
    new Request("http://localhost/scoped", { headers: { "x-request-id": "first" } }),
  );
  const second = await application.handle(
    new Request("http://localhost/scoped", { headers: { "x-request-id": "second" } }),
  );

  const firstBody = (await first.json()) as Record<string, unknown>;
  const secondBody = (await second.json()) as Record<string, unknown>;

  expect(firstBody.requestId).toBe("first");
  expect(secondBody.requestId).toBe("second");
  // One instance per request: the controller and the provider it injected are
  // built for that request, and a second request gets its own pair.
  expect(secondBody.controller).not.toBe(firstBody.controller);
  expect(secondBody.service).not.toBe(firstBody.service);

  await application.close();
});

test("bubbles request scope to a controller that only depends on a singleton", async () => {
  const application = await AponiaFactory.create(ScopedAppModule, { logger: false });

  const first = await application.handle(
    new Request("http://localhost/bubbled", { headers: { "x-request-id": "one" } }),
  );
  const second = await application.handle(
    new Request("http://localhost/bubbled", { headers: { "x-request-id": "two" } }),
  );

  const firstBody = (await first.json()) as Record<string, unknown>;
  const secondBody = (await second.json()) as Record<string, unknown>;

  expect(firstBody.requestId).toBe("one");
  expect(secondBody.requestId).toBe("two");
  // `BubbledService` declares nothing, but it reaches a request-scoped
  // provider, so it and the controller above it are constructed per request.
  expect(secondBody.service).not.toBe(firstBody.service);
  expect(secondBody.scoped).not.toBe(firstBody.scoped);

  await application.close();
});

test("does not construct request-scoped instances at boot", async () => {
  const before = serviceInstances;
  const application = await AponiaFactory.create(ScopedAppModule, { logger: false });

  // The eager pass skipped the request-scoped provider and the singleton that
  // bubbles to request scope, so nothing was constructed without a request.
  expect(serviceInstances).toBe(before);

  await application.close();
});

test("refuses strict code generation for a request-scoped controller", async () => {
  const error = await bootFailure(() =>
    AponiaFactory.create(ScopedAppModule, { logger: false, strictCodegen: true }),
  );

  expect(error).toMatchObject({ code: "UNSAFE_CODE_GENERATION" });
});

test("refuses a request-scoped controller that mounts through a registration callback", async () => {
  const requestValue = createToken<string>("test.callback-request");
  const callbackController = defineController(class CallbackController {}, {
    inject: [requestValue] as const,
    registerRoutes: () => {},
  });

  const module = defineModule({
    id: "CallbackModule",
    controllers: [callbackController],
    providers: [provideValue(requestValue, "value", { scope: Scope.REQUEST })],
  });

  const error = await bootFailure(() => AponiaFactory.create(module, { logger: false }));

  expect(error).toMatchObject({ code: "INVALID_CONTROLLER" });
});

test("refuses message patterns on a request-scoped controller", async () => {
  @Injectable({ scope: Scope.REQUEST })
  @Controller("messaging")
  class MessagingController {
    constructor(readonly service: RequestScopedService) {}

    @MessagePattern("scoped.read")
    read(): string {
      return "handled";
    }
  }

  @Module({
    imports: [RequestContextModule.forRoot()],
    controllers: [MessagingController],
    providers: [RequestScopedService],
  })
  class MessagingModule {}

  const error = await bootFailure(() => AponiaFactory.create(MessagingModule, { logger: false }));

  expect(error).toMatchObject({ code: "INVALID_CONTROLLER" });
});

test("refuses a WebSocket gateway whose lifetime bubbles to request scope", async () => {
  @Injectable()
  @WebSocketGateway("/scoped-socket")
  class ScopedGateway {
    constructor(readonly service: RequestScopedService) {}
  }

  @Module({
    imports: [RequestContextModule.forRoot()],
    providers: [RequestScopedService, ScopedGateway],
  })
  class GatewayModule {}

  const error = await bootFailure(() => AponiaFactory.create(GatewayModule, { logger: false }));

  expect(error).toMatchObject({ code: "INVALID_WEBSOCKET_GATEWAY" });
});

@Injectable({ scope: Scope.REQUEST })
@Controller("worker-messaging")
class WorkerMessagingController {
  @MessagePattern("worker.read")
  read(): string {
    return "handled";
  }
}

@Module({
  imports: [RequestContextModule.forRoot()],
  controllers: [WorkerMessagingController],
})
class WorkerMessagingModule {}

test("a worker context skips request-scoped controllers that declare no message patterns", async () => {
  const context = await AponiaFactory.createApplicationContext(ScopedAppModule, {
    logger: false,
    microservices: [workerTransport],
  });

  await context.close();
});

test("a worker context refuses message patterns on a request-scoped controller", async () => {
  const error = await bootFailure(() =>
    AponiaFactory.createApplicationContext(WorkerMessagingModule, {
      logger: false,
      microservices: [workerTransport],
    }),
  );

  expect(error).toMatchObject({ code: "INVALID_CONTROLLER" });
});

/** A transport that keeps no messages: these cases only reach the worker boot. */
const workerTransport = {
  name: "worker-memory",
  subscribe(): void {},
  close(): void {},
};

@Controller("worker-plain")
class PlainWorkerController {
  @Get()
  read(): string {
    return "ok";
  }
}

@Module({ controllers: [PlainWorkerController] })
class PlainWorkerModule {}

test("a worker context collects message handlers from singleton controllers", async () => {
  const context = await AponiaFactory.createApplicationContext(PlainWorkerModule, {
    logger: false,
    microservices: [workerTransport],
  });

  await context.close();
});

/** The failure a boot raises, so a case can assert its code rather than a message. */
async function bootFailure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  return undefined;
}
