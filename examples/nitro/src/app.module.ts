import { Controller, Get, Module } from "@aponiajs/common";

@Controller("nitro-api")
export class NitroApiController {
  @Get()
  status(): { readonly status: string } {
    return { status: "running on nitro" };
  }
}

@Module({
  controllers: [NitroApiController],
})
export class AppModule {}
