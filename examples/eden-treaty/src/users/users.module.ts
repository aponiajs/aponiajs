import { Module } from "@aponiajs/common";
import { UsersController } from "./users.controller.ts";
import { UsersService } from "./users.service.ts";

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
