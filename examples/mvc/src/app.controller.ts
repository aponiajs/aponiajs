import { Controller, Get, Render } from "@aponiajs/common";

@Controller()
export class AppController {
  @Get()
  @Render("<h1>Welcome to {{framework}} MVC!</h1>")
  home() {
    return { framework: "AponiaJS" };
  }

  @Get("profile")
  @Render("<div>User: {{username}}, Role: {{role}}</div>")
  profile() {
    return { username: "alice", role: "admin" };
  }
}
