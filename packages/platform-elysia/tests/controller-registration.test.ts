import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  defineElysiaController,
  registerElysiaControllerRoutes,
} from "../src/controllers/controller-definition.ts";

class PluginOnlyController {
  greet(): string {
    return "plugin";
  }
}

const pluginOnlyController = defineElysiaController(PluginOnlyController, {
  inject: [] as const,
  buildPlugin: (controller) => new Elysia().get("/plugin-only", () => controller.greet()),
});

class DirectController {}

const directController = defineElysiaController(DirectController, {
  inject: [] as const,
  path: "/direct",
  registerRoutes: (application) => application.get("/direct/ping", () => "pong"),
});

test("leaves the shared application untouched for a plugin-only controller", async () => {
  const application = new Elysia();

  expect(
    registerElysiaControllerRoutes(pluginOnlyController, application, new PluginOnlyController()),
  ).toBeUndefined();

  const response = await application.handle(new Request("http://localhost/plugin-only"));

  expect(response.status).toBe(404);
  expect(application.routes).toHaveLength(0);
});

test("registers the routes of a directly registered controller", async () => {
  const application = new Elysia();

  registerElysiaControllerRoutes(directController, application, new DirectController());

  const response = await application.handle(new Request("http://localhost/direct/ping"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("pong");
});
