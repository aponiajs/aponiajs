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
import { CatalogService, type Item } from "./catalog.service.ts";
import { createItemSchema, searchItemsSchema, type CreateItem } from "./catalog.schema.ts";

/**
 * Use case: validated routes across every HTTP method decorator, with the
 * handler's own annotations providing the types.
 */
@Controller("items")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post("/", createItemSchema)
  create(@Body() body: CreateItem): Item {
    return this.catalogService.create(body);
  }

  @Get("search", searchItemsSchema)
  search(@Query("term") term: string, @Query("take") take: number | undefined): readonly Item[] {
    return this.catalogService.search(term, take ?? 10);
  }

  @Get(":id")
  findOne(@Param("id") id: string): Item | { message: string } {
    return this.catalogService.findOne(id) ?? { message: "not found" };
  }

  @Put(":id", createItemSchema)
  replace(@Param("id") id: string, @Body() body: CreateItem): Item {
    return { id, ...body };
  }

  @Patch(":id")
  rename(@Param("id") id: string, @Query("name") name: string): { id: string; name: string } {
    return { id, name };
  }

  @Delete(":id")
  remove(@Param("id") id: string): { id: string; removed: boolean } {
    return { id, removed: true };
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
