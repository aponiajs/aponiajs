import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

const seen: string[] = [];
let firstRequestStarted = false;
let firstStartedSignal: Deferred | undefined;
let firstRelease: Deferred | undefined;
let secondObservedSignal: Deferred | undefined;

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

@Injectable()
class SlowGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest().request;

    if (!firstRequestStarted && request.url.includes("id=1")) {
      firstRequestStarted = true;
      firstStartedSignal?.resolve();
      await (firstRelease?.promise ?? Promise.resolve());
    }

    // Read the context again after the await. Before the per-request fork, a
    // second request on this route had already replaced the shared pointer.
    const settled = context.switchToHttp().getRequest().request;
    seen.push(settled.url);
    if (settled.url.includes("id=2")) {
      secondObservedSignal?.resolve();
    }
    return true;
  }
}

@Controller("race")
@UseGuards(SlowGuard)
class RaceController {
  @Get("first")
  first(): string {
    return "ok";
  }
}

@Module({ controllers: [RaceController], providers: [SlowGuard] })
class RaceModule {}

describe("enhancer execution context isolation", () => {
  test("a concurrent request on the same route cannot replace another request's context", async () => {
    seen.length = 0;
    firstRequestStarted = false;

    const firstStarted = deferred();
    const secondObserved = deferred();
    const releaseFirst = deferred();
    firstStartedSignal = firstStarted;
    secondObservedSignal = secondObserved;
    firstRelease = releaseFirst;

    const application = await AponiaFactory.create(RaceModule, { logger: false });

    const first = application.handle(new Request("http://localhost/race/first?id=1"));
    await firstStarted.promise;

    const second = application.handle(new Request("http://localhost/race/first?id=2"));
    await secondObserved.promise;

    releaseFirst.resolve();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect([firstResponse.status, secondResponse.status]).toEqual([200, 200]);
    expect([...seen].sort()).toEqual([
      "http://localhost/race/first?id=1",
      "http://localhost/race/first?id=2",
    ]);

    await application.close();
  });
});
