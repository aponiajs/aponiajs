import { Controller, EventPattern, MessagePattern, Payload } from "@aponiajs/common";
import { MathService, type SumInput } from "./math.service.ts";

@Controller("math")
export class MathController {
  constructor(private readonly mathService: MathService) {}

  @MessagePattern("math.double")
  double(@Payload() value: number): number {
    return this.mathService.double(value);
  }

  @MessagePattern("math.sum")
  sum(@Payload() input: SumInput): number {
    return this.mathService.sum(input.a, input.b);
  }

  @EventPattern("math.record")
  record(@Payload() value: number): void {
    this.mathService.record(value);
  }
}
