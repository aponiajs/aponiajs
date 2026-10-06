import { describe, expect, test } from "bun:test";
import { buildLinkableGraph } from "../src/endpoints/linkable-graph.ts";
import type { AponiaApplicationInspection } from "@aponiajs/platform-elysia";

describe("linkable-graph", () => {
  test("generates interconnected nodes and edges from inspection data", () => {
    const inspection: AponiaApplicationInspection = {
      rootModule: "AppModule",
      modules: [
        {
          id: "DatabaseModule",
          instanceId: undefined,
          imports: [],
          controllers: [],
          providers: [
            {
              token: "DatabaseService",
              kind: "class",
              dependencies: [],
            },
          ],
          exports: ["DatabaseService"],
        },
        {
          id: "AppModule",
          instanceId: undefined,
          imports: ["DatabaseModule"],
          controllers: ["AppController"],
          providers: [
            {
              token: "AppService",
              kind: "class",
              dependencies: ["DatabaseService"],
            },
            {
              token: "UnusedService",
              kind: "class",
              dependencies: [],
            },
          ],
          exports: [],
        },
      ],
      routes: [
        {
          method: "GET",
          path: "/hello",
          module: "AppModule",
          controller: "AppController",
          handler: "getHello",
          parameters: [],
        },
      ],
      gateways: [
        {
          module: "AppModule",
          token: "AppGateway",
          path: "/ws",
          events: ["ping"],
        },
      ],
    };

    const graph = buildLinkableGraph(inspection);

    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);

    // Verify node IDs
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("module:AppModule");
    expect(nodeIds).toContain("module:DatabaseModule");
    expect(nodeIds).toContain("controller:AppController");
    expect(nodeIds).toContain("provider:DatabaseService");
    expect(nodeIds).toContain("provider:AppService");
    expect(nodeIds).toContain("provider:UnusedService");
    expect(nodeIds).toContain("gateway:AppGateway");
    expect(nodeIds).toContain("route:GET:/hello");

    // Verify edges
    expect(
      graph.edges.some(
        (e) =>
          e.source === "module:AppModule" &&
          e.target === "module:DatabaseModule" &&
          e.type === "MODULE_IMPORTS",
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.source === "module:DatabaseModule" &&
          e.target === "provider:DatabaseService" &&
          e.type === "MODULE_EXPORTS",
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.source === "provider:AppService" &&
          e.target === "provider:DatabaseService" &&
          e.type === "INJECTS",
      ),
    ).toBe(true);

    expect(
      graph.edges.some(
        (e) =>
          e.source === "controller:AppController" &&
          e.target === "route:GET:/hello" &&
          e.type === "MOUNTS_ROUTE",
      ),
    ).toBe(true);

    // Verify diagnostics
    expect(graph.diagnostics.unusedProviders).toContain("UnusedService");
    expect(graph.diagnostics.unusedProviders).not.toContain("DatabaseService");
    expect(graph.diagnostics.unusedProviders).not.toContain("AppService");
  });
});
