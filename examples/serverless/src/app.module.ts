import { Controller, Get, Module } from "@aponiajs/common";

@Controller("hello")
export class HelloController {
  @Get()
  sayHello(): string {
    return "Hello from Serverless Aponia!";
  }
}

@Module({
  controllers: [HelloController],
})
export class AppModule {}
