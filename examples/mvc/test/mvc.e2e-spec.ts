import { expect, test } from "bun:test";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { ViewService } from "@aponiajs/view";
import { AppModule } from "../src/app.module.ts";

test("renders HTML views through ViewModule and templates", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const viewService = application.get(ViewService);

  const homeHtml = await viewService.render("<h1>Welcome to {{framework}} MVC!</h1>", {
    framework: "AponiaJS",
  });
  expect(homeHtml).toBe("<h1>Welcome to AponiaJS MVC!</h1>");

  const profileHtml = await viewService.render("<div>User: {{username}}, Role: {{role}}</div>", {
    username: "alice",
    role: "admin",
  });
  expect(profileHtml).toBe("<div>User: alice, Role: admin</div>");

  await application.close();
});
