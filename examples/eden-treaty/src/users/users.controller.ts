import { Body, Controller, Get, Param, Post } from "@aponiajs/common";
import { t } from "elysia";
import { CreateUserSchema, type CreateUserInput, UserSchema } from "../models/user.schema.ts";
import { UsersService } from "./users.service.ts";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("", {
    response: t.Array(t.Object({ id: t.Number(), name: t.String() })),
  })
  findAll() {
    return this.usersService.findAll();
  }

  @Get(":id", {
    params: t.Object({ id: t.Number() }),
    response: UserSchema,
  })
  findById(@Param("id") id: number) {
    return this.usersService.findById(id);
  }

  @Post("", {
    body: CreateUserSchema,
    response: UserSchema,
  })
  create(@Body() body: CreateUserInput) {
    return this.usersService.create(body);
  }
}
