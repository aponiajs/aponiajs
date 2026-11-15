import { expect, spyOn, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

@Controller("default-logger")
class DefaultLoggerController {
  @Get("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ controllers: [DefaultLoggerController] })
class DefaultLoggerModule {}

test.serial("boots with the default framework logger and serves its routes", async () => {
  const stdout: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });

  try {
    const application = await AponiaFactory.create(DefaultLoggerModule);
    const response = await application.handle(new Request("http://localhost/default-logger/ping"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pong");
  } finally {
    write.mockRestore();
  }

  const output = stdout.join("");
  expect(output).toContain("Starting Aponia application...");
  expect(output).toContain("DefaultLoggerController {/default-logger}:");
  expect(output).toContain("Mapped {/default-logger/ping, GET} route");
});
