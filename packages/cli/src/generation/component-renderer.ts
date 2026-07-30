import type { ComponentNames } from "./component-names.types.ts";
import { classSuffix } from "./schematic-definitions.ts";
import type { ComponentSchematic } from "./schematic.types.ts";

export function renderComponent(schematic: ComponentSchematic, names: ComponentNames): string {
  const className = `${names.className}${classSuffix(schematic)}`;
  switch (schematic) {
    case "controller":
      return `import { Controller } from "@aponiajs/common";\n\n@Controller("${names.routePath}")\nexport class ${className} {}\n`;
    case "module":
      return `import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class ${className} {}\n`;
    case "service":
    case "provider":
      return `import { Injectable } from "@aponiajs/common";\n\n@Injectable()\nexport class ${className} {}\n`;
    case "gateway":
      return `import { WebSocketGateway } from "@aponiajs/common";\n\n@WebSocketGateway("/${names.routePath}")\nexport class ${className} {}\n`;
    case "decorator":
      return `export function ${className}(): MethodDecorator {\n  return () => undefined;\n}\n`;
    case "interface":
      return `export interface ${className} {}\n`;
    case "guard":
      return `export class ${className} {\n  canActivate(): boolean {\n    return true;\n  }\n}\n`;
    case "interceptor":
      return `export class ${className} {\n  intercept<T>(next: () => T): T {\n    return next();\n  }\n}\n`;
    case "middleware":
      return `export class ${className} {\n  async use(request: Request, next: () => Response | Promise<Response>): Promise<Response> {\n    void request;\n    return next();\n  }\n}\n`;
    case "pipe":
      return `export class ${className} {\n  transform<T>(value: T): T {\n    return value;\n  }\n}\n`;
    case "filter":
      return `export class ${className} {\n  catch(error: unknown): unknown {\n    return error;\n  }\n}\n`;
    default:
      return `export class ${className} {}\n`;
  }
}

export function renderComponentSpec(
  schematic: ComponentSchematic,
  names: ComponentNames,
  stem: string,
): string {
  if (schematic === "gateway") {
    const className = `${names.className}${classSuffix(schematic)}`;
    return `import { expect, test } from "bun:test";\nimport { getWebSocketGatewayMetadata } from "@aponiajs/common";\nimport { ${className} } from "./${stem}.ts";\n\ntest("${className} exposes its WebSocket path", () => {\n  expect(getWebSocketGatewayMetadata(${className})?.path).toBe("/${names.routePath}");\n});\n`;
  }

  return renderSimpleSpec(`./${stem}.ts`, `${names.className}${classSuffix(schematic)}`);
}

export function renderSimpleSpec(importPath: string, className: string): string {
  return `import { expect, test } from "bun:test";\nimport { ${className} } from "${importPath}";\n\ntest("${className} is defined", () => {\n  expect(new ${className}()).toBeDefined();\n});\n`;
}
