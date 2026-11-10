import { Module } from "@aponiajs/common";
import { MathModule } from "./math/math.module.ts";

@Module({
  imports: [MathModule],
})
export class AppModule {}
