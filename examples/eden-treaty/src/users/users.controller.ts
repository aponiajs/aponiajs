import { Body, Controller, Get, Param, Post } from "@aponiajs/common";
import { t } from "elysia";
import { CreateUserDto, type CreateUserInput, UserDto } from "../models/user.dto.ts";
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
    response: UserDto,
  })
  findById(@Param("id") id: number) {
    return this.usersService.findById(id);
  }

  @Post("", {
    body: CreateUserDto,
    response: UserDto,
  })
  create(@Body() body: CreateUserInput) {
    return this.usersService.create(body);
  }
}
