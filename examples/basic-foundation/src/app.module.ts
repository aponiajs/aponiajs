import { Module } from "@aponiajs/common";
import { GreetingModule } from "./greeting/greeting.module.ts";

@Module({
  imports: [GreetingModule],
})
export class AppModule {}
