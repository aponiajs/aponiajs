import { afterEach, expect, test } from "bun:test";
import { Module } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import {
  MicroserviceClientsModule,
  microserviceClientToken,
  type MicroserviceClient,
} from "./index.ts";

const client = {
  connect: () => Promise.resolve(),
  send: () => Promise.resolve(undefined),
  emit: () => Promise.resolve(),
  close: () => Promise.resolve(),
} as unknown as MicroserviceClient;

test("forRootAsync resolves the client at boot", async () => {
  @Module({
    imports: [
      MicroserviceClientsModule.forRootAsync({
        useFactory: () => ({ client, autoConnect: false }),
      }),
    ],
  })
  class AppModule {}

  application = await AponiaFactory.create(AppModule, { logger: false });

  expect(application.get(microserviceClientToken)).toBe(client);
});

test("forRootAsync refuses an invalid factory result at boot", async () => {
  @Module({
    imports: [
      MicroserviceClientsModule.forRootAsync({
        useFactory: () => ({ client, autoConnect: "yes" as never }),
      }),
    ],
  })
  class AppModule {}

  let failure: unknown;
  try {
    await AponiaFactory.create(AppModule, { logger: false });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
});

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});
