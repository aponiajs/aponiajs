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
import { CatalogService, type CatalogItem } from "./catalog.service.ts";

type CreateItem = Omit<CatalogItem, "id">;

/**
 * One router covering every HTTP method decorator. Paths join the controller
 * prefix, so `@Get(":id")` answers `GET /items/:id`. Validation lives in the
 * `validation` example; this one is about routing.
 */
@Controller("items")
export class ItemsController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post()
  create(@Body() body: CreateItem): CatalogItem {
    return this.catalogService.create(body);
  }

  @Get(":id")
  findOne(@Param("id") id: string): CatalogItem | { message: string } {
    return this.catalogService.findOne(id) ?? { message: "not found" };
  }

  @Put(":id")
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
