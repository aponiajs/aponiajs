import { expect, test } from "bun:test";
import {
  APP_FILTER,
  APP_INTERCEPTOR,
  Catch,
  Controller,
  Get,
  Injectable,
  Module,
  provideClass,
  provideValue,
  type ExceptionFilter,
  type Interceptor,
} from "@aponiajs/common";
import { AponiaFactory } from "../index.ts";

/**
 * The application-wide enhancer declarations a boot collects from every
 * module: interceptors and filters declared through `APP_*`, in module order.
 * A class entry resolves in the module that declared it; an instance entry is
 * the instance. Both shapes are booted, because the filter projection reads a
 * class token from one and the instance's constructor from the other.
 */

const order: string[] = [];

@Injectable()
class AppInterceptor implements Interceptor {
  interceptBefore(): void {
    order.push("interceptor-before");
  }

  interceptAfter(): void {
    order.push("interceptor-after");
  }
}

@Catch(RangeError)
@Injectable()
class ClassFilter implements ExceptionFilter {
  catch(exception: unknown): Response {
    order.push("class-filter");
    return new Response(String((exception as Error).message), { status: 422 });
  }
}

@Catch()
@Injectable()
class InstanceFilter implements ExceptionFilter {
  catch(): Response {
    order.push("instance-filter");
    return new Response("instance", { status: 500 });
  }
}

const instanceFilter = new InstanceFilter();

@Controller("enhanced")
class EnhancedController {
  @Get()
  read(): string {
    order.push("handler");
    return "enhanced";
  }

  @Get("range")
  range(): never {
    throw new RangeError("out of range");
  }

  @Get("boom")
  boom(): never {
    throw new Error("boom");
  }
}

@Module({
  controllers: [EnhancedController],
  providers: [
    provideClass(APP_INTERCEPTOR, AppInterceptor, []),
    provideClass(APP_FILTER, ClassFilter, []),
    provideValue(APP_FILTER, instanceFilter),
  ],
})
class EnhancerModule {}

test("application-wide interceptors wrap every route and filters answer in declaration order", async () => {
  order.length = 0;
  const application = await AponiaFactory.create(EnhancerModule, { logger: false });

  try {
    const ok = await application.handle(new Request("http://localhost/enhanced"));
    expect(await ok.text()).toBe("enhanced");
    expect(order).toEqual(["interceptor-before", "handler", "interceptor-after"]);

    order.length = 0;
    const ranged = await application.handle(new Request("http://localhost/enhanced/range"));
    expect(ranged.status).toBe(422);
    expect(await ranged.text()).toBe("out of range");
    expect(order).toEqual(["interceptor-before", "class-filter"]);

    order.length = 0;
    const boom = await application.handle(new Request("http://localhost/enhanced/boom"));
    expect(boom.status).toBe(500);
    expect(await boom.text()).toBe("instance");
    expect(order).toEqual(["interceptor-before", "instance-filter"]);
  } finally {
    await application.close();
  }
});
