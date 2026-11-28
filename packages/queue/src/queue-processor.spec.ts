import { afterEach, describe, expect, test } from "bun:test";
import { Inject, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import {
  InjectQueue,
  JOB_REF,
  Processor,
  QueueModule,
  QueueService,
  WorkerHost,
  getQueueToken,
  type QueueJob,
} from "./index.ts";

interface EmailPayload {
  readonly to: string;
}

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

@Processor("email")
class EmailProcessor extends WorkerHost {
  readonly processed: string[] = [];

  constructor(@Inject(JOB_REF) private readonly jobRef: QueueJob) {
    super();
  }

  async process(job: QueueJob<EmailPayload>): Promise<void> {
    // The injected reference forwards to the job the queue is handling.
    expect(this.jobRef.id).toBe(job.id);
    this.processed.push(job.payload.to);
  }
}

@Injectable()
class EmailEnqueuer {
  constructor(@InjectQueue("email") readonly queue: QueueService) {}
}

describe("the BullMQ-shaped processor surface over the in-process queue", () => {
  test("runs a @Processor() method for the job name it declares", async () => {
    const processor = new EmailProcessor({} as QueueJob);

    @Module({
      imports: [QueueModule.forRoot({ name: "email", queue: { autoStart: false } })],
      providers: [EmailProcessor, EmailEnqueuer],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const queue = application.get(QueueService);

    queue.enqueue("email", { to: "ada@example.com" });
    await queue.drain();

    expect(application.get(EmailProcessor)).not.toBe(processor);
    expect((application.get(EmailProcessor) as EmailProcessor).processed).toEqual([
      "ada@example.com",
    ]);
  });

  test("@InjectQueue resolves the registration's named queue token", async () => {
    @Module({
      imports: [QueueModule.forRoot({ name: "email", queue: { autoStart: false } })],
      providers: [EmailEnqueuer],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect(getQueueToken("email")).toBe("AponiaQueue_email");
    expect(getQueueToken()).toBe("AponiaQueue_default");
    expect(application.get(EmailEnqueuer).queue).toBe(application.get(QueueService));
    expect(application.get("AponiaQueue_email")).toBe(application.get(QueueService));
  });

  test("WorkerHost.worker refuses instead of inventing a broker worker", () => {
    class Host extends WorkerHost {
      process(): void {}
    }

    expect(() => new Host().worker).toThrow(expect.objectContaining({ code: "INVALID_QUEUE_JOB" }));
  });

  test("JOB_REF forwards to the current job and is undefined outside one", async () => {
    @Injectable()
    class JobReader {
      constructor(@Inject(JOB_REF) readonly job: QueueJob) {}
    }

    @Module({
      imports: [QueueModule.forRoot({ queue: { autoStart: false } })],
      providers: [JobReader],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const reader = application.get(JobReader);

    expect(reader.job.id).toBeUndefined();
    expect(reader.job.name).toBeUndefined();
  });

  test("refuses an empty processor name at the decoration site", () => {
    expect(() => Processor("")).toThrow(TypeError);
  });
});
