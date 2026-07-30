import { camelCase, pascalCase } from "change-case";
import type { ResourceTransport } from "../commands/command.types.ts";
import type { ComponentNames } from "./component-names.types.ts";
import { resourceTransportStem } from "./schematic-definitions.ts";

export function renderResourceModule(names: ComponentNames, transportStem: string): string {
  const transportClass = `${names.className}${pascalCase(transportStem)}`;
  const metadata =
    transportStem === "controller"
      ? `controllers: [${transportClass}],\n  providers: [${names.className}Service],`
      : `providers: [${transportClass}, ${names.className}Service],`;
  return `import { Module } from "@aponiajs/common";\nimport { ${transportClass} } from "./${names.fileName}.${transportStem}.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Module({\n  ${metadata}\n})\nexport class ${names.className}Module {}\n`;
}

export function renderResourceController(names: ComponentNames, crud: boolean): string {
  if (!crud) {
    return `import { Controller } from "@aponiajs/common";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Controller("${names.routePath}")\nexport class ${names.className}Controller {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n}\n`;
  }

  const single = names.singularClassName;
  return `import { Body, Controller, Delete, Get, Param, Patch, Post } from "@aponiajs/common";\nimport { Create${single}, Update${single}, ${single}Params } from "./${names.fileName}.model.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Controller("${names.routePath}")\nexport class ${names.className}Controller {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n\n  @Post("/", { body: Create${single} })\n  create(@Body() input: Create${single}) {\n    return this.${names.propertyName}Service.create(input);\n  }\n\n  @Get()\n  findAll() {\n    return this.${names.propertyName}Service.findAll();\n  }\n\n  @Get(":id", { params: ${single}Params })\n  findOne(@Param() params: ${single}Params) {\n    return this.${names.propertyName}Service.findOne(params.id);\n  }\n\n  @Patch(":id", { params: ${single}Params, body: Update${single} })\n  update(@Param() params: ${single}Params, @Body() input: Update${single}) {\n    return this.${names.propertyName}Service.update(params.id, input);\n  }\n\n  @Delete(":id", { params: ${single}Params })\n  remove(@Param() params: ${single}Params) {\n    return this.${names.propertyName}Service.remove(params.id);\n  }\n}\n`;
}

export function renderResourceService(
  names: ComponentNames,
  crud: boolean,
  type: ResourceTransport,
): string {
  if (!crud) {
    return `import { Injectable } from "@aponiajs/common";\n\n@Injectable()\nexport class ${names.className}Service {}\n`;
  }
  const dtoSuffix = type.startsWith("graphql") ? "input" : "dto";
  const typeSuffix = pascalCase(dtoSuffix);
  const modelSuffix = type === "rest" ? "" : typeSuffix;
  const modelImports =
    type === "rest"
      ? `import type { Create${names.singularClassName}, Update${names.singularClassName} } from "./${names.fileName}.model.ts";`
      : `import type { Create${names.singularClassName}${typeSuffix} } from "./dto/create-${names.singularFileName}.${dtoSuffix}.ts";\nimport type { Update${names.singularClassName}${typeSuffix} } from "./dto/update-${names.singularFileName}.${dtoSuffix}.ts";`;
  return `import { Injectable } from "@aponiajs/common";\n${modelImports}\nimport type { ${names.singularClassName} } from "./entities/${names.singularFileName}.entity.ts";\n\n@Injectable()\nexport class ${names.className}Service {\n  private readonly items: ${names.singularClassName}[] = [];\n\n  create(input: Create${names.singularClassName}${modelSuffix}): ${names.singularClassName} {\n    const item = { id: crypto.randomUUID(), name: input.name };\n    this.items.push(item);\n    return item;\n  }\n\n  findAll(): readonly ${names.singularClassName}[] {\n    return this.items;\n  }\n\n  findOne(id: string): ${names.singularClassName} | undefined {\n    return this.items.find((item) => item.id === id);\n  }\n\n  update(id: string, input: Update${names.singularClassName}${modelSuffix}): ${names.singularClassName} | undefined {\n    const item = this.findOne(id);\n    if (!item) return undefined;\n    Object.assign(item, input);\n    return item;\n  }\n\n  remove(id: string): boolean {\n    const index = this.items.findIndex((item) => item.id === id);\n    if (index < 0) return false;\n    this.items.splice(index, 1);\n    return true;\n  }\n}\n`;
}

export function renderResourceModel(names: ComponentNames): string {
  const paramsSchemaName = `${camelCase(names.singularFileName)}ParamsSchema`;
  return `import { Validation, type InferValidatorOutput } from "@aponiajs/common";\nimport { t } from "elysia";\n\n/* oxlint-disable typescript/no-unsafe-declaration-merging -- Validation models are metadata tokens for Elysia-validated plain objects; Aponia never constructs them. */\n\nconst create${names.singularClassName}Schema = t.Object({\n  name: t.String({ minLength: 1 }),\n});\n\n@Validation(create${names.singularClassName}Schema)\nexport class Create${names.singularClassName} {}\nexport interface Create${names.singularClassName} extends InferValidatorOutput<typeof create${names.singularClassName}Schema> {}\n\nconst update${names.singularClassName}Schema = t.Partial(create${names.singularClassName}Schema);\n\n@Validation(update${names.singularClassName}Schema)\nexport class Update${names.singularClassName} {}\nexport interface Update${names.singularClassName} extends InferValidatorOutput<typeof update${names.singularClassName}Schema> {}\n\nconst ${paramsSchemaName} = t.Object({\n  id: t.String(),\n});\n\n@Validation(${paramsSchemaName})\nexport class ${names.singularClassName}Params {}\nexport interface ${names.singularClassName}Params extends InferValidatorOutput<typeof ${paramsSchemaName}> {}\n`;
}

export function renderCreateDto(names: ComponentNames, suffix: "dto" | "input"): string {
  const typeSuffix = pascalCase(suffix);
  return `export class Create${names.singularClassName}${typeSuffix} {\n  name = "";\n}\n`;
}

export function renderUpdateDto(names: ComponentNames, suffix: "dto" | "input"): string {
  const typeSuffix = pascalCase(suffix);
  return `import type { Create${names.singularClassName}${typeSuffix} } from "./create-${names.singularFileName}.${suffix}.ts";\n\nexport type Update${names.singularClassName}${typeSuffix} = Partial<Create${names.singularClassName}${typeSuffix}>;\n`;
}

export function renderEntity(names: ComponentNames): string {
  return `export class ${names.singularClassName} {\n  id = "";\n  name = "";\n}\n`;
}

export function renderResourceTransport(
  names: ComponentNames,
  type: ResourceTransport,
  crud: boolean,
): string {
  const stem = resourceTransportStem(type);
  const className = `${names.className}${pascalCase(stem)}`;
  if (type === "ws") {
    return renderWebSocketGateway(names, className, crud);
  }

  const method = crud
    ? `\n  findAll() {\n    return this.${names.propertyName}Service.findAll();\n  }\n`
    : "";
  return `import { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n/** ${type} transport scaffold. Connect this class to the matching Aponia platform package. */\nexport class ${className} {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n${method}}\n`;
}

export function renderResourceServiceSpec(names: ComponentNames): string {
  return `import { expect, test } from "bun:test";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\ntest("${names.className}Service creates and returns resources", () => {\n  const service = new ${names.className}Service();\n  const created = service.create({ name: "sample" });\n  expect(service.findOne(created.id)).toEqual(created);\n});\n`;
}

export function renderResourceTransportSpec(
  names: ComponentNames,
  stem: string,
  crud: boolean,
): string {
  const className = `${names.className}${pascalCase(stem)}`;
  if (stem === "gateway") {
    const expectedEvents = crud
      ? `[
    "${names.routePath}.create",
    "${names.routePath}.findAll",
    "${names.routePath}.findOne",
    "${names.routePath}.update",
    "${names.routePath}.remove",
  ]`
      : "[]";
    return `import { expect, test } from "bun:test";\nimport { getWebSocketGatewayMetadata, getWebSocketMessageMetadata } from "@aponiajs/common";\nimport { ${className} } from "./${names.fileName}.${stem}.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\ntest("${className} exposes its WebSocket contract", () => {\n  const gateway = new ${className}(new ${names.className}Service());\n\n  expect(gateway).toBeDefined();\n  expect(getWebSocketGatewayMetadata(${className})?.path).toBe("/${names.routePath}");\n  expect(getWebSocketMessageMetadata(${className}).map(({ event }) => event)).toEqual(${expectedEvents});\n});\n`;
  }

  return `import { expect, test } from "bun:test";\nimport { ${className} } from "./${names.fileName}.${stem}.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\ntest("${className} is defined", () => {\n  expect(new ${className}(new ${names.className}Service())).toBeDefined();\n});\n`;
}

function renderWebSocketGateway(names: ComponentNames, className: string, crud: boolean): string {
  const commonImport = crud
    ? `import { MessageBody, SubscribeMessage, WebSocketGateway } from "@aponiajs/common";`
    : `import { WebSocketGateway } from "@aponiajs/common";`;
  const dtoImports = crud
    ? `import type { Create${names.singularClassName}Dto } from "./dto/create-${names.singularFileName}.dto.ts";\nimport type { Update${names.singularClassName}Dto } from "./dto/update-${names.singularFileName}.dto.ts";\n`
    : "";
  const handlers = crud
    ? `
  @SubscribeMessage("${names.routePath}.create")
  create(@MessageBody() input: Create${names.singularClassName}Dto) {
    return this.${names.propertyName}Service.create(input);
  }

  @SubscribeMessage("${names.routePath}.findAll")
  findAll() {
    return this.${names.propertyName}Service.findAll();
  }

  @SubscribeMessage("${names.routePath}.findOne")
  findOne(@MessageBody("id") id: string) {
    return this.${names.propertyName}Service.findOne(id);
  }

  @SubscribeMessage("${names.routePath}.update")
  update(@MessageBody("id") id: string, @MessageBody("input") input: Update${names.singularClassName}Dto) {
    return this.${names.propertyName}Service.update(id, input);
  }

  @SubscribeMessage("${names.routePath}.remove")
  remove(@MessageBody("id") id: string) {
    return this.${names.propertyName}Service.remove(id);
  }
`
    : "";

  return `${commonImport}\n${dtoImports}import { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@WebSocketGateway("/${names.routePath}")\nexport class ${className} {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n${handlers}}\n`;
}
