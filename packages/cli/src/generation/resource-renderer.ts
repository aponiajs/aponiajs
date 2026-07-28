import { pascalCase } from "change-case";
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
  return `import { Body, Controller, Delete, Get, Param, Patch, Post } from "@aponiajs/common";\nimport type { Create${single}Dto } from "./dto/create-${names.singularFileName}.dto.ts";\nimport type { Update${single}Dto } from "./dto/update-${names.singularFileName}.dto.ts";\nimport {\n  create${single}Route,\n  find${single}Route,\n  update${single}Route,\n} from "./${names.fileName}.schema.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Controller("${names.routePath}")\nexport class ${names.className}Controller {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n\n  @Post("/", create${single}Route)\n  create(@Body() input: Create${single}Dto) {\n    return this.${names.propertyName}Service.create(input);\n  }\n\n  @Get()\n  findAll() {\n    return this.${names.propertyName}Service.findAll();\n  }\n\n  @Get(":id", find${single}Route)\n  findOne(@Param("id") id: string) {\n    return this.${names.propertyName}Service.findOne(id);\n  }\n\n  @Patch(":id", update${single}Route)\n  update(@Param("id") id: string, @Body() input: Update${single}Dto) {\n    return this.${names.propertyName}Service.update(id, input);\n  }\n\n  @Delete(":id", find${single}Route)\n  remove(@Param("id") id: string) {\n    return this.${names.propertyName}Service.remove(id);\n  }\n}\n`;
}

export function renderResourceService(
  names: ComponentNames,
  crud: boolean,
  dtoSuffix: "dto" | "input",
): string {
  if (!crud) {
    return `import { Injectable } from "@aponiajs/common";\n\n@Injectable()\nexport class ${names.className}Service {}\n`;
  }
  const typeSuffix = pascalCase(dtoSuffix);
  return `import { Injectable } from "@aponiajs/common";\nimport type { Create${names.singularClassName}${typeSuffix} } from "./dto/create-${names.singularFileName}.${dtoSuffix}.ts";\nimport type { Update${names.singularClassName}${typeSuffix} } from "./dto/update-${names.singularFileName}.${dtoSuffix}.ts";\nimport type { ${names.singularClassName} } from "./entities/${names.singularFileName}.entity.ts";\n\n@Injectable()\nexport class ${names.className}Service {\n  private readonly items: ${names.singularClassName}[] = [];\n\n  create(input: Create${names.singularClassName}${typeSuffix}): ${names.singularClassName} {\n    const item = { id: crypto.randomUUID(), ...input };\n    this.items.push(item);\n    return item;\n  }\n\n  findAll(): readonly ${names.singularClassName}[] {\n    return this.items;\n  }\n\n  findOne(id: string): ${names.singularClassName} | undefined {\n    return this.items.find((item) => item.id === id);\n  }\n\n  update(id: string, input: Update${names.singularClassName}${typeSuffix}): ${names.singularClassName} | undefined {\n    const item = this.findOne(id);\n    if (!item) return undefined;\n    Object.assign(item, input);\n    return item;\n  }\n\n  remove(id: string): boolean {\n    const index = this.items.findIndex((item) => item.id === id);\n    if (index < 0) return false;\n    this.items.splice(index, 1);\n    return true;\n  }\n}\n`;
}

export function renderResourceSchema(names: ComponentNames): string {
  return `import { t } from "elysia";\n\nexport const create${names.singularClassName}Schema = t.Object({\n  name: t.String({ minLength: 1 }),\n});\n\nexport const update${names.singularClassName}Schema = t.Partial(create${names.singularClassName}Schema);\n\nexport const ${names.singularClassName.toLowerCase()}ParamsSchema = t.Object({\n  id: t.String(),\n});\n\nexport const create${names.singularClassName}Route = {\n  body: create${names.singularClassName}Schema,\n};\n\nexport const find${names.singularClassName}Route = {\n  params: ${names.singularClassName.toLowerCase()}ParamsSchema,\n};\n\nexport const update${names.singularClassName}Route = {\n  params: ${names.singularClassName.toLowerCase()}ParamsSchema,\n  body: update${names.singularClassName}Schema,\n};\n`;
}

export function renderCreateDto(
  names: ComponentNames,
  suffix: "dto" | "input",
  validated: boolean,
): string {
  const typeSuffix = pascalCase(suffix);
  if (validated) {
    return `import type { Static } from "elysia";\nimport type { create${names.singularClassName}Schema } from "../${names.fileName}.schema.ts";\n\nexport type Create${names.singularClassName}${typeSuffix} = Static<typeof create${names.singularClassName}Schema>;\n`;
  }
  return `export class Create${names.singularClassName}${typeSuffix} {\n  name = "";\n}\n`;
}

export function renderUpdateDto(
  names: ComponentNames,
  suffix: "dto" | "input",
  validated: boolean,
): string {
  const typeSuffix = pascalCase(suffix);
  if (validated) {
    return `import type { Static } from "elysia";\nimport type { update${names.singularClassName}Schema } from "../${names.fileName}.schema.ts";\n\nexport type Update${names.singularClassName}${typeSuffix} = Static<typeof update${names.singularClassName}Schema>;\n`;
  }
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
  const method = crud
    ? `\n  findAll() {\n    return this.${names.propertyName}Service.findAll();\n  }\n`
    : "";
  return `import { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n/** ${type} transport scaffold. Connect this class to the matching Aponia platform package. */\nexport class ${className} {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n${method}}\n`;
}

export function renderResourceServiceSpec(names: ComponentNames): string {
  return `import { expect, test } from "bun:test";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\ntest("${names.className}Service creates and returns resources", () => {\n  const service = new ${names.className}Service();\n  const created = service.create({ name: "sample" });\n  expect(service.findOne(created.id)).toEqual(created);\n});\n`;
}

export function renderResourceTransportSpec(names: ComponentNames, stem: string): string {
  const className = `${names.className}${pascalCase(stem)}`;
  return `import { expect, test } from "bun:test";\nimport { ${className} } from "./${names.fileName}.${stem}.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\ntest("${className} is defined", () => {\n  expect(new ${className}(new ${names.className}Service())).toBeDefined();\n});\n`;
}
