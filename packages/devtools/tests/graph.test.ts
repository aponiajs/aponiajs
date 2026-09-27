import { expect, test } from "bun:test";
import {
  Controller,
  Get,
  Injectable,
  Module,
  SubscribeMessage,
  WebSocketGateway,
  defineModule,
  type LoggerService,
  type ModuleDefinition,
} from "@aponiajs/common";
import { AponiaFactory, type AponiaModuleDescriptorArtifact } from "@aponiajs/platform-elysia";
import { Elysia } from "elysia";
import {
  aponiaVersion,
  startDevtoolsServer,
  type AponiaGraphPayload,
  type DevtoolsServer,
} from "../src/index.ts";

/**
 * The compiled-graph endpoint. The contract is HTTP, so every case fetches a
 * socket that bound port `0` and reads the address it took back out of it, and
 * the payload assertions are the wire shape rather than the server's internals.
 *
 * What these cases pin beyond the field names is where the graph comes from: an
 * application booting from a descriptor artifact has to be described as the
 * graph it compiled, and one whose artifact was refused as the decorated classes
 * it named instead. Only one of those two is reachable per boot, so both are
 * booted.
 */

const silentLogger: LoggerService = {
  log: () => {},
  fatal: () => {},
  error: () => {},
  warn: () => {},
};

/** Binds the loopback socket on port `0` and reads the address it took. */
function serveLoopback(application: Elysia): DevtoolsServer {
  const server = startDevtoolsServer({ application, port: 0, logger: silentLogger });

  if (server === undefined) {
    throw new Error("the devtools server refused to bind the loopback socket");
  }

  return server;
}

async function readGraph(server: DevtoolsServer): Promise<AponiaGraphPayload> {
  const response = await fetch(`${server.url}/__devtools/graph`);

  expect(response.status).toBe(200);

  return (await response.json()) as AponiaGraphPayload;
}

@Injectable()
class GraphService {
  pong(): string {
    return "pong";
  }
}

// The fixture carries a route on purpose: `routes` is absent from this payload
// because the endpoint does not serve them, not because this application has
// none, and an application without a route could not tell the two apart.
@Controller("graph")
class GraphController {
  constructor(private readonly service: GraphService) {}

  @Get("ping")
  ping(): string {
    return this.service.pong();
  }
}

@WebSocketGateway("/graph-socket")
class GraphGateway {
  @SubscribeMessage("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ providers: [GraphService], exports: [GraphService] })
class GraphSupportModule {}

@Module({
  imports: [GraphSupportModule],
  controllers: [GraphController],
  providers: [GraphGateway],
})
class AppModule {}

/**
 * An artifact declaring the root under an id of its own, so a case can tell the
 * graph the declaration names from the decorated class it replaces.
 */
const declaredRootModule: ModuleDefinition = defineModule({ id: "DeclaredGraphModule" });

function descriptorArtifact(framework: string): AponiaModuleDescriptorArtifact {
  return { framework, elysia: null, modules: { AppModule: declaredRootModule } };
}

test("graph reports the compiled root with its modules, and carries no routes key", async () => {
  const application = await AponiaFactory.createNative(AppModule, { logger: false });
  const server = serveLoopback(application);

  try {
    const response = await fetch(`${server.url}/__devtools/graph`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const payload = await readGraph(server);

    // The absence is asserted as an absence: a consumer reading `routes` here
    // would be reading the routes a controller declares, when `/routes` is the
    // endpoint that reports the routes the server answers.
    expect(Object.hasOwn(payload, "routes")).toBe(false);

    // One assertion for the whole wire shape, so a field added or renamed here
    // fails rather than passing under a per-field read. `instanceId` is
    // `undefined` here because a statically declared module has none, and JSON
    // carries no key for it.
    expect(payload).toEqual({
      rootModule: "AppModule",
      modules: [
        {
          id: "GraphSupportModule",
          instanceId: undefined,
          imports: [],
          controllers: [],
          providers: [{ token: "GraphService", kind: "class", dependencies: [] }],
          exports: ["GraphService"],
        },
        {
          id: "AppModule",
          instanceId: undefined,
          imports: ["GraphSupportModule"],
          controllers: ["GraphController"],
          providers: [{ token: "GraphGateway", kind: "class", dependencies: [] }],
          exports: [],
        },
      ],
      gateways: [
        {
          module: "AppModule",
          token: "GraphGateway",
          path: "/graph-socket",
          events: ["ping"],
        },
      ],
    });
  } finally {
    server.stop();
  }
});

test("graph describes the decorated root when the descriptor artifact is refused", async () => {
  // The artifact holds a declaration for the root name, so only its stamp keeps
  // it from serving: a descriptor built by another release is refused, and the
  // boot lowers the decorated class instead. That lowered graph is the one this
  // endpoint has to report, because it is the one the application compiled.
  const application = await AponiaFactory.createNative(AppModule, {
    logger: false,
    descriptors: descriptorArtifact("0.0.0-older"),
  });
  const server = serveLoopback(application);

  try {
    const payload = await readGraph(server);

    expect(payload.rootModule).toBe("AppModule");
    expect(payload.modules.map((module) => module.id)).toEqual(["GraphSupportModule", "AppModule"]);
    expect(payload.modules.map((module) => module.id)).not.toContain("DeclaredGraphModule");
  } finally {
    server.stop();
  }
});

test("graph reports the root the adopted descriptor artifact declares", async () => {
  const application = await AponiaFactory.createNative(AppModule, {
    logger: false,
    descriptors: descriptorArtifact(aponiaVersion),
  });
  const server = serveLoopback(application);

  try {
    const payload = await readGraph(server);

    // The declaration carries an id of its own, and neither decorated module is
    // named: an endpoint that lowered the classes would answer "AppModule" with
    // this fixture's controller and gateway under it.
    expect(payload.rootModule).toBe("DeclaredGraphModule");
    expect(payload.modules.map((module) => module.id)).toEqual(["DeclaredGraphModule"]);
    expect(payload.gateways).toEqual([]);
  } finally {
    server.stop();
  }
});

test("a record from a copy of the platform older than the compiled root serves no graph", async () => {
  // The record is read through a registry-global symbol key, so a boot run by an
  // older copy of `@aponiajs/platform-elysia` in this process is reachable from
  // here — and that copy's record has no `rootModule` at all. The handler build
  // runs inside the plugin's `onStart`, which Elysia neither awaits nor catches,
  // so a record with no compiled root has to read as a boot this server serves
  // no graph for rather than fail a boot that is otherwise fine.
  const application = new Elysia();
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "0.0.0-older",
      graph: "decorated",
      invokers: { accepted: false, reason: undefined },
    },
    enumerable: false,
  });

  const server = serveLoopback(application);

  try {
    // The server is up — the other endpoint still answers — and the graph
    // endpoint is simply not one this boot has anything to say for.
    expect((await fetch(`${server.url}/__devtools/meta`)).status).toBe(200);
    expect((await fetch(`${server.url}/__devtools/graph`)).status).toBe(404);
  } finally {
    server.stop();
  }
});

test("a record whose compiled root this release cannot project serves no graph", async () => {
  // A record a copy of the platform newer than this one wrote can carry a
  // compiled root this release cannot lower. Compiling it would throw out of the
  // handler build and take the boot's `listen()` with it, so the build answers
  // "no graph" for the record instead.
  const application = new Elysia();
  Object.defineProperty(application, Symbol.for("aponia.application.diagnostics"), {
    value: {
      framework: "9.9.9-future",
      graph: "declared",
      invokers: { accepted: true, reason: undefined },
      rootModule: class ForeignRoot {},
    },
    enumerable: false,
  });

  const server = serveLoopback(application);

  try {
    expect((await fetch(`${server.url}/__devtools/meta`)).status).toBe(200);
    expect((await fetch(`${server.url}/__devtools/graph`)).status).toBe(404);
  } finally {
    server.stop();
  }
});
