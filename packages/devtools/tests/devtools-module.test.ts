import { expect, spyOn, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { DevtoolsModule } from "../src/index.ts";

// `0` is the standard "no fixed port" sentinel, and nothing in this task binds
// one: the value is configuration the report echoes back. The socket assertion
// arrives with the server in Task 4, on an ephemeral port.
const configuredPort = 0;

@Controller("health")
class HealthController {
  @Get("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ imports: [DevtoolsModule.register({ enabled: false })] })
class DisabledModule {}

@Module({
  imports: [DevtoolsModule.register({ enabled: true, port: configuredPort })],
  controllers: [HealthController],
})
class EnabledModule {}

@Module({ imports: [DevtoolsModule.register({ enabled: true })] })
class DefaultPortModule {}

interface CapturedOutput {
  readonly rows: () => readonly string[];
  readonly restore: () => void;
}

/**
 * The devtools plugin reports through the framework logger, which writes to
 * `process.stdout`. Capturing it here keeps Elysia's own startup banner out of
 * the assertion: only the rows carrying the `Devtools` context are read.
 */
function captureOutput(): CapturedOutput {
  const chunks: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });

  return {
    rows: () => chunks.join("").split("\n"),
    restore: () => write.mockRestore(),
  };
}

function devtoolsReports(output: CapturedOutput): readonly string[] {
  return output.rows().filter((row) => row.includes("[Devtools]"));
}

test("register returns an inert module when disabled and a plugin module when enabled", () => {
  const disabled = DevtoolsModule.register({ enabled: false });

  expect(disabled.module).toBe(DevtoolsModule);
  expect(disabled.providers).toEqual([]);
  expect(disabled.imports).toEqual([]);
  expect(Object.isFrozen(disabled)).toBe(true);

  const enabled = DevtoolsModule.register({ enabled: true });

  expect(enabled.id).toBe("ElysiaPluginModule[devtools]");
  expect(enabled.providers).toHaveLength(1);
  expect(Object.isFrozen(enabled)).toBe(true);
});

// The enabled twin below makes the same two observations, and finds both
// present. Absence here is therefore evidence that the plugin did not mount,
// not that the boot logs nothing.
test.serial("a listening disabled application mounts no plugin", async () => {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(DisabledModule);
    await application.listen(0);
    await application.close();

    expect(output.rows().join("")).not.toContain("ElysiaPluginModule[devtools]");
    expect(devtoolsReports(output)).toEqual([]);
  } finally {
    output.restore();
  }
});

test.serial("an enabled module mounts its plugin, which reports at onStart", async () => {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(EnabledModule);
    await application.listen(0);
    await application.close();

    expect(output.rows().join("")).toContain(
      "ElysiaPluginModule[devtools] dependencies initialized",
    );

    const reports = devtoolsReports(output);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(`127.0.0.1:${configuredPort}`);
  } finally {
    output.restore();
  }
});

test.serial("an enabled module reports the loopback port it defaults to", async () => {
  const output = captureOutput();
  try {
    const application = await AponiaFactory.create(DefaultPortModule);
    await application.listen(0);
    await application.close();

    const reports = devtoolsReports(output);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("127.0.0.1:8000");
  } finally {
    output.restore();
  }
});

test.serial(
  "an application that only handles requests stays unlistened, so the plugin reports nothing",
  async () => {
    const output = captureOutput();
    try {
      const application = await AponiaFactory.create(EnabledModule, { logger: false });

      const response = await application.handle(new Request("http://localhost/health/ping"));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("pong");
      expect(() => application.getUrl()).toThrow(
        expect.objectContaining({ code: "APPLICATION_NOT_LISTENING" }),
      );
      expect(devtoolsReports(output)).toEqual([]);
    } finally {
      output.restore();
    }
  },
);
