import { Controller, Get } from "@aponiajs/common";
import { Inertia } from "@aponiajs/mvc";

const users = [
  { id: "1", name: "Ada", role: "admin" },
  { id: "2", name: "Linus", role: "member" },
];

@Controller("users")
export class UsersController {
  @Get()
  @Inertia("Users/Index")
  index() {
    return { users };
  }
}
