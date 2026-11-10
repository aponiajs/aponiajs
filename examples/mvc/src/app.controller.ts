import { Controller, Get, Render } from "@aponiajs/common";
import { Inertia } from "@aponiajs/mvc";

const users = [
  { id: "1", name: "Ada", role: "admin" },
  { id: "2", name: "Linus", role: "member" },
];

@Controller()
export class AppController {
  @Get()
  @Render("home")
  home() {
    return { title: "AponiaJS MVC" };
  }

  @Get("users")
  @Render("users.index")
  index() {
    return { title: "Users", users };
  }

  @Get("inertia/users")
  @Inertia("Users/Index")
  inertiaUsers() {
    return { users };
  }
}
