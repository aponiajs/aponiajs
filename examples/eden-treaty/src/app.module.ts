import { Module } from "@aponiajs/common";
import { UsersModule } from "./users/users.module.ts";

@Module({
  imports: [UsersModule],
})
export class AppModule {}
