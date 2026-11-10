import { Context, Controller, Get, Render, type RouteContext } from "@aponiajs/common";
import { Inertia, inertia } from "@aponiajs/mvc";
import { view } from "@aponiajs/view";

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

  @Get("direct-view")
  directView() {
    return view("users.index", { title: "Direct View", users });
  }

  @Get("inertia/users")
  @Inertia("Users/Index")
  inertiaUsers() {
    return { users };
  }

  @Get("direct-inertia")
  directInertia(@Context() ctx: RouteContext) {
    return inertia("Users/Index", { users }, ctx);
  }
}
