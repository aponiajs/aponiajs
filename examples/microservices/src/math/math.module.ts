import { Module } from "@aponiajs/common";
import { MathController } from "./math.controller.ts";
import { MathService } from "./math.service.ts";

@Module({
  controllers: [MathController],
  providers: [MathService],
  exports: [MathService],
})
export class MathModule {}
