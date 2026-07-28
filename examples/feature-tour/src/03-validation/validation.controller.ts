import { Body, Controller, Get, Headers, Post, Query } from "@aponiajs/common";
import { CatalogService, type CatalogItem } from "../02-modules/catalog.service.ts";
import {
  createItemSchema,
  searchItemsSchema,
  tenantHeaderSchema,
  type CreateItem,
} from "./item.schema.ts";

/**
 * Use case 03 — a rejected request answers 422 and never reaches the handler.
 * Types come from the handler's own annotations, not from schema inference.
 */
@Controller("validated")
export class ValidationController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post("items", createItemSchema)
  create(@Body() body: CreateItem): CatalogItem {
    return this.catalogService.create(body);
  }

  @Get("items", searchItemsSchema)
  search(
    @Query("term") term: string,
    @Query("take") take: number | undefined,
  ): readonly CatalogItem[] {
    return this.catalogService.search(term, take ?? 10);
  }

  @Get("tenant", tenantHeaderSchema)
  readTenant(@Headers("x-tenant") tenant: string): { tenant: string } {
    return { tenant };
  }
}
