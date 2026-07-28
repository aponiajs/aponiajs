import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Options,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@aponiajs/common";
import { CatalogService, type CatalogItem } from "../02-modules/catalog.service.ts";
import { createItemSchema, type CreateItem } from "../03-validation/item.schema.ts";

/**
 * Use case 04 — one controller covering every HTTP method decorator. Paths join
 * the controller prefix, so `@Get(":id")` answers `GET /items/:id`.
 */
@Controller("items")
export class HttpMethodsController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post("/", createItemSchema)
  create(@Body() body: CreateItem): CatalogItem {
    return this.catalogService.create(body);
  }

  @Get(":id")
  findOne(@Param("id") id: string): CatalogItem | { message: string } {
    return this.catalogService.findOne(id) ?? { message: "not found" };
  }

  @Put(":id", createItemSchema)
  replace(@Param("id") id: string, @Body() body: CreateItem): CatalogItem {
    return this.catalogService.replace(id, body);
  }

  @Patch(":id")
  rename(@Param("id") id: string, @Query("name") name: string): { id: string; name: string } {
    return { id, name };
  }

  @Delete(":id")
  remove(@Param("id") id: string): { id: string; removed: boolean } {
    return { id, removed: this.catalogService.remove(id) };
  }

  @Head()
  exists(): null {
    return null;
  }

  @Options()
  describe(): { description: string } {
    return { description: this.catalogService.describe() };
  }
}
