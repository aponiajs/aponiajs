import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import {
  ClientsModule,
  MODULE_OPTIONS_TOKEN,
  MicroserviceClientsModule,
  microserviceClientToken,
  type MicroserviceClient,
} from "./index.ts";

const client = {
  name: "test",
  target: "test",
  connect: () => Promise.resolve(),
  send: () => Promise.resolve(undefined),
  emit: () => Promise.resolve(),
  close: () => Promise.resolve(),
} as unknown as MicroserviceClient;

describe("MicroserviceClientsModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = MicroserviceClientsModule.forRoot({ client, autoConnect: false });

    expect(pluginRegistrationIssues(MicroserviceClientsModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, MicroserviceClientsModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("MicroserviceClientsModule");
    expect(definition.exports).toContain(microserviceClientToken);
  });

  test("publishes the Nest name as an alias of the module class", () => {
    expect(ClientsModule).toBe(MicroserviceClientsModule);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        MicroserviceClientsModule.forRoot({ client, autoConnect: false }),
        MicroserviceClientsModule.forRoot({ client, autoConnect: false }),
        MicroserviceClientsModule,
      ),
    ).toEqual([]);
  });

  test("isGlobal reaches the definition when stated", () => {
    expect(MicroserviceClientsModule.forRoot({ client }).global).toBe(false);
    expect(MicroserviceClientsModule.forRoot({ client, isGlobal: true }).global).toBe(true);
    expect(() => MicroserviceClientsModule.forRoot({ client, isGlobal: 1 as never })).toThrow(
      AponiaError,
    );
  });

  test("the register alias delegates to forRoot", () => {
    expect(MicroserviceClientsModule.register({ client }).module).toBe(MicroserviceClientsModule);
  });

  test("accepts the three asynchronous shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        MicroserviceClientsModule.forRootAsync.bind(MicroserviceClientsModule),
        MicroserviceClientsModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
  });

  test("refuses a registration without a client", () => {
    const error = capture(() => MicroserviceClientsModule.forRoot({} as never));

    expect(error.code).toBe("INVALID_MICROSERVICE_OPTIONS");
    expect(error.details.issues).toEqual(["client must be a client instance or configuration"]);
  });
});

function capture(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
