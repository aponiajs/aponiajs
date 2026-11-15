import {
  Controller,
  DefaultValuePipe,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Query,
  type PipeTransform,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

class ConformanceMultiplyPipe implements PipeTransform<number, number> {
  transform(value: number): number {
    return value * 10;
  }
}

@Controller("vp-pipes")
class VpPipesController {
  @Get("items/:id")
  getItem(@Param("id", ParseIntPipe) id: number) {
    return { id, isNumber: typeof id === "number" };
  }

  @Get("calc/:val")
  calc(@Param("val", ParseIntPipe, new ConformanceMultiplyPipe()) val: number) {
    return { val };
  }

  @Get("default")
  getDefault(@Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return { page };
  }
}

@Module({
  controllers: [VpPipesController],
})
class VpPipesModule {}

test("the Vite+ lane transforms parameters via ParseIntPipe", async () => {
  const application = await AponiaFactory.create(VpPipesModule, { logger: false });

  try {
    const resSuccess = await application.handle(new Request("http://localhost/vp-pipes/items/77"));
    expect(resSuccess.status).toBe(200);
    expect(await resSuccess.json()).toEqual({ id: 77, isNumber: true });

    const resFail = await application.handle(new Request("http://localhost/vp-pipes/items/abc"));
    expect(resFail.status).toBe(400);
  } finally {
    await application.close();
  }
});

test("the Vite+ lane chains pipes and defaults", async () => {
  const application = await AponiaFactory.create(VpPipesModule, { logger: false });

  try {
    const resChained = await application.handle(new Request("http://localhost/vp-pipes/calc/4"));
    expect(resChained.status).toBe(200);
    expect(await resChained.json()).toEqual({ val: 40 });

    const resDefault = await application.handle(new Request("http://localhost/vp-pipes/default"));
    expect(resDefault.status).toBe(200);
    expect(await resDefault.json()).toEqual({ page: 1 });
  } finally {
    await application.close();
  }
});
