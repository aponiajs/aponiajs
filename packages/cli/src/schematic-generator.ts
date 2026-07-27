import { pascalCase } from "change-case";
import findFiles from "fast-glob";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { GenerateCommandOptions, GenerateSchematic, ResourceTransport } from "./arguments.ts";
import {
  createComponentNames,
  normalizeNameSegments,
  type ComponentNames,
} from "./component-names.ts";
import { registerInModule, type ModuleRegistrationKind } from "./module-registration.ts";
import { generateProject } from "./project-generator.ts";
import { aponiaVersion } from "./version.ts";

export interface GenerateSchematicOptions extends GenerateCommandOptions {
  readonly cwd?: string;
}

export interface SchematicChange {
  readonly kind: "CREATE" | "UPDATE";
  readonly path: string;
}

export interface GenerateSchematicResult {
  readonly changes: readonly SchematicChange[];
  readonly dryRun: boolean;
}

interface PendingFile {
  readonly path: string;
  readonly content: string;
  readonly kind: "CREATE" | "UPDATE";
}

interface AponiaConfiguration {
  readonly sourceRoot?: string;
  readonly generateOptions?: GenerateDefaults;
  readonly projects?: Readonly<
    Record<
      string,
      {
        readonly root?: string;
        readonly sourceRoot?: string;
        readonly generateOptions?: GenerateDefaults;
      }
    >
  >;
}

interface GenerateDefaults {
  readonly flat?: boolean;
  readonly spec?: boolean | Readonly<Partial<Record<GenerateSchematic, boolean>>>;
}

interface SchematicDefinition {
  readonly defaultFlat: boolean;
  readonly spec: boolean;
  readonly suffix: string;
  readonly registration?: ModuleRegistrationKind;
}

const definitions: Readonly<
  Record<Exclude<GenerateSchematic, "app" | "library" | "resource">, SchematicDefinition>
> = {
  class: { defaultFlat: true, spec: true, suffix: "" },
  controller: {
    defaultFlat: false,
    spec: true,
    suffix: "controller",
    registration: "controllers",
  },
  decorator: { defaultFlat: true, spec: false, suffix: "decorator" },
  filter: { defaultFlat: true, spec: true, suffix: "filter" },
  gateway: { defaultFlat: true, spec: true, suffix: "gateway", registration: "providers" },
  guard: { defaultFlat: true, spec: true, suffix: "guard" },
  interface: { defaultFlat: true, spec: false, suffix: "interface" },
  interceptor: { defaultFlat: true, spec: true, suffix: "interceptor" },
  middleware: { defaultFlat: true, spec: true, suffix: "middleware" },
  module: { defaultFlat: false, spec: false, suffix: "module", registration: "imports" },
  pipe: { defaultFlat: true, spec: true, suffix: "pipe" },
  provider: { defaultFlat: true, spec: true, suffix: "", registration: "providers" },
  resolver: {
    defaultFlat: false,
    spec: true,
    suffix: "resolver",
    registration: "providers",
  },
  service: {
    defaultFlat: false,
    spec: true,
    suffix: "service",
    registration: "providers",
  },
};

export async function generateSchematic(
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const projectRoot = resolve(options.cwd ?? process.cwd());
  const names = createComponentNames(options.name);

  if (options.schematic === "app") {
    return generateApplication(projectRoot, names.fileName, options);
  }
  if (options.schematic === "library") {
    return generateLibrary(projectRoot, names, options);
  }

  const configuration = await readConfiguration(projectRoot);
  const project = resolveProject(configuration, options.project);
  const sourceRoot = resolveInside(
    projectRoot,
    project.sourceRoot ?? configuration.sourceRoot ?? "src",
  );
  const basePath = options.path ? resolveInside(projectRoot, options.path) : sourceRoot;
  const spec =
    options.spec ??
    readSpecDefault(project.generateOptions?.spec, options.schematic) ??
    readSpecDefault(configuration.generateOptions?.spec, options.schematic) ??
    true;
  const effectiveOptions: GenerateSchematicOptions = {
    ...options,
    flat: options.flat ?? project.generateOptions?.flat ?? configuration.generateOptions?.flat,
  };

  const files =
    options.schematic === "resource"
      ? createResourceFiles(basePath, names, effectiveOptions, spec)
      : createComponentFiles(basePath, names, effectiveOptions, spec);

  const registration = registrationFor(options.schematic);
  if (registration && !options.skipImport) {
    const primary = primaryFile(files, options.schematic);
    const moduleFile = await findModuleFile({
      projectRoot,
      sourceRoot,
      fromDirectory: dirname(primary.path),
      requestedModule: options.module,
      excludedFile: options.schematic === "module" ? primary.path : undefined,
    });
    if (moduleFile) {
      const original = await Bun.file(moduleFile).text();
      const symbol = symbolFor(options.schematic, names);
      const importPath = toImportPath(moduleFile, primary.path);
      const updated = registerInModule(original, registration, symbol, importPath);
      if (updated !== original) {
        files.push({ path: moduleFile, content: updated, kind: "UPDATE" });
      }
    }
  }

  return writePendingFiles(projectRoot, files, options.dryRun);
}

function createComponentFiles(
  basePath: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
  specEnabled: boolean,
): PendingFile[] {
  const schematic = options.schematic as Exclude<GenerateSchematic, "app" | "library" | "resource">;
  const definition = definitions[schematic];
  const flat = options.flat ?? definition.defaultFlat;
  const parentSegments = normalizeNameSegments(options.name).slice(0, -1);
  const directory = join(basePath, ...parentSegments, ...(flat ? [] : [names.fileName]));
  const stem = definition.suffix ? `${names.fileName}.${definition.suffix}` : names.fileName;
  const files: PendingFile[] = [
    {
      path: join(directory, `${stem}.ts`),
      content: renderComponent(schematic, names),
      kind: "CREATE",
    },
  ];

  if (definition.spec && specEnabled) {
    files.push({
      path: join(directory, `${stem}.spec.ts`),
      content: renderComponentSpec(schematic, names, stem),
      kind: "CREATE",
    });
  }

  return files;
}

function createResourceFiles(
  basePath: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
  specEnabled: boolean,
): PendingFile[] {
  const flat = options.flat ?? false;
  const parentSegments = normalizeNameSegments(options.name).slice(0, -1);
  const directory = join(basePath, ...parentSegments, ...(flat ? [] : [names.fileName]));
  const transportStem = resourceTransportStem(options.type);
  const dtoSuffix = options.type.startsWith("graphql") ? "input" : "dto";
  const files: PendingFile[] = [
    createFile(
      directory,
      `${names.fileName}.module.ts`,
      renderResourceModule(names, transportStem),
    ),
    createFile(
      directory,
      `${names.fileName}.service.ts`,
      renderResourceService(names, options.crud, dtoSuffix),
    ),
  ];

  const validated = options.crud && options.type === "rest";
  if (validated) {
    files.push(createFile(directory, `${names.fileName}.schema.ts`, renderResourceSchema(names)));
  }

  if (options.crud) {
    files.push(
      createFile(
        join(directory, "dto"),
        `create-${names.singularFileName}.${dtoSuffix}.ts`,
        renderCreateDto(names, dtoSuffix, validated),
      ),
      createFile(
        join(directory, "dto"),
        `update-${names.singularFileName}.${dtoSuffix}.ts`,
        renderUpdateDto(names, dtoSuffix, validated),
      ),
      createFile(
        join(directory, "entities"),
        `${names.singularFileName}.entity.ts`,
        renderEntity(names),
      ),
    );
  }

  if (options.type === "rest") {
    files.push(
      createFile(
        directory,
        `${names.fileName}.controller.ts`,
        renderResourceController(names, options.crud),
      ),
    );
  } else {
    files.push(
      createFile(
        directory,
        `${names.fileName}.${transportStem}.ts`,
        renderResourceTransport(names, options.type, options.crud),
      ),
    );
  }

  if (specEnabled) {
    files.push(
      createFile(
        directory,
        `${names.fileName}.service.spec.ts`,
        options.crud
          ? renderResourceServiceSpec(names)
          : renderSimpleSpec(`./${names.fileName}.service.ts`, `${names.className}Service`),
      ),
      createFile(
        directory,
        `${names.fileName}.${transportStem}.spec.ts`,
        renderResourceTransportSpec(names, transportStem),
      ),
    );
  }

  return files;
}

async function generateApplication(
  projectRoot: string,
  name: string,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const appsDirectory = join(projectRoot, "apps");
  if (!options.dryRun) {
    await mkdir(appsDirectory, { recursive: true });
  }
  const result = await generateProject({
    name,
    cwd: appsDirectory,
    dryRun: options.dryRun,
    skipInstall: true,
  });

  return {
    dryRun: options.dryRun,
    changes: result.files.map((file) => ({
      kind: "CREATE",
      path: join("apps", name, file),
    })),
  };
}

async function generateLibrary(
  projectRoot: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
): Promise<GenerateSchematicResult> {
  const directory = join(projectRoot, "packages", names.fileName);
  const files: PendingFile[] = [
    createFile(
      directory,
      "package.json",
      `${JSON.stringify(
        {
          name: names.fileName,
          version: "0.0.0",
          private: true,
          type: "module",
          scripts: {
            build: "bun build ./src/index.ts --outdir ./dist --target bun",
            test: "bun test",
          },
          dependencies: {
            "@aponiajs/common": aponiaVersion,
          },
        },
        undefined,
        2,
      )}\n`,
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.module.ts`,
      `import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class ${names.className}Module {}\n`,
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.service.ts`,
      `import { Injectable } from "@aponiajs/common";\n\n@Injectable()\nexport class ${names.className}Service {}\n`,
    ),
    createFile(
      join(directory, "src"),
      `${names.fileName}.service.spec.ts`,
      renderSimpleSpec(`./${names.fileName}.service.ts`, `${names.className}Service`),
    ),
    createFile(
      join(directory, "src"),
      "index.ts",
      `export { ${names.className}Module } from "./${names.fileName}.module.ts";\nexport { ${names.className}Service } from "./${names.fileName}.service.ts";\n`,
    ),
  ];

  return writePendingFiles(projectRoot, files, options.dryRun);
}

async function writePendingFiles(
  projectRoot: string,
  files: readonly PendingFile[],
  dryRun: boolean,
): Promise<GenerateSchematicResult> {
  const creates = files.filter((file) => file.kind === "CREATE");
  for (const file of creates) {
    if (await Bun.file(file.path).exists()) {
      throw new Error(`File "${relative(projectRoot, file.path)}" already exists.`);
    }
  }

  if (!dryRun) {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      await Bun.write(file.path, file.content);
    }
  }

  return {
    dryRun,
    changes: files.map((file) => ({
      kind: file.kind,
      path: relative(projectRoot, file.path),
    })),
  };
}

function renderComponent(schematic: keyof typeof definitions, names: ComponentNames): string {
  const className = `${names.className}${classSuffix(schematic)}`;
  switch (schematic) {
    case "controller":
      return `import { Controller } from "@aponiajs/common";\n\n@Controller("${names.routePath}")\nexport class ${className} {}\n`;
    case "module":
      return `import { Module } from "@aponiajs/common";\n\n@Module({})\nexport class ${className} {}\n`;
    case "service":
    case "provider":
      return `import { Injectable } from "@aponiajs/common";\n\n@Injectable()\nexport class ${className} {}\n`;
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

function renderComponentSpec(
  schematic: keyof typeof definitions,
  names: ComponentNames,
  stem: string,
): string {
  return renderSimpleSpec(`./${stem}.ts`, `${names.className}${classSuffix(schematic)}`);
}

function renderSimpleSpec(importPath: string, className: string): string {
  return `import { expect, test } from "bun:test";\nimport { ${className} } from "${importPath}";\n\ntest("${className} is defined", () => {\n  expect(new ${className}()).toBeDefined();\n});\n`;
}

function renderResourceModule(names: ComponentNames, transportStem: string): string {
  const transportClass = `${names.className}${pascalCase(transportStem)}`;
  const metadata =
    transportStem === "controller"
      ? `controllers: [${transportClass}],\n  providers: [${names.className}Service],`
      : `providers: [${transportClass}, ${names.className}Service],`;
  return `import { Module } from "@aponiajs/common";\nimport { ${transportClass} } from "./${names.fileName}.${transportStem}.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Module({\n  ${metadata}\n})\nexport class ${names.className}Module {}\n`;
}

function renderResourceController(names: ComponentNames, crud: boolean): string {
  if (!crud) {
    return `import { Controller } from "@aponiajs/common";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Controller("${names.routePath}")\nexport class ${names.className}Controller {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n}\n`;
  }

  const single = names.singularClassName;
  return `import { Body, Controller, Delete, Get, Param, Patch, Post } from "@aponiajs/common";\nimport type { Create${single}Dto } from "./dto/create-${names.singularFileName}.dto.ts";\nimport type { Update${single}Dto } from "./dto/update-${names.singularFileName}.dto.ts";\nimport {\n  create${single}Route,\n  find${single}Route,\n  update${single}Route,\n} from "./${names.fileName}.schema.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\n@Controller("${names.routePath}")\nexport class ${names.className}Controller {\n  constructor(private readonly ${names.propertyName}Service: ${names.className}Service) {}\n\n  @Post("/", create${single}Route)\n  create(@Body() input: Create${single}Dto) {\n    return this.${names.propertyName}Service.create(input);\n  }\n\n  @Get()\n  findAll() {\n    return this.${names.propertyName}Service.findAll();\n  }\n\n  @Get(":id", find${single}Route)\n  findOne(@Param("id") id: string) {\n    return this.${names.propertyName}Service.findOne(id);\n  }\n\n  @Patch(":id", update${single}Route)\n  update(@Param("id") id: string, @Body() input: Update${single}Dto) {\n    return this.${names.propertyName}Service.update(id, input);\n  }\n\n  @Delete(":id", find${single}Route)\n  remove(@Param("id") id: string) {\n    return this.${names.propertyName}Service.remove(id);\n  }\n}\n`;
}

function renderResourceService(
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

function renderResourceSchema(names: ComponentNames): string {
  return `import { t } from "elysia";\n\nexport const create${names.singularClassName}Schema = t.Object({\n  name: t.String({ minLength: 1 }),\n});\n\nexport const update${names.singularClassName}Schema = t.Partial(create${names.singularClassName}Schema);\n\nexport const ${names.singularClassName.toLowerCase()}ParamsSchema = t.Object({\n  id: t.String(),\n});\n\nexport const create${names.singularClassName}Route = {\n  body: create${names.singularClassName}Schema,\n};\n\nexport const find${names.singularClassName}Route = {\n  params: ${names.singularClassName.toLowerCase()}ParamsSchema,\n};\n\nexport const update${names.singularClassName}Route = {\n  params: ${names.singularClassName.toLowerCase()}ParamsSchema,\n  body: update${names.singularClassName}Schema,\n};\n`;
}

function renderCreateDto(
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

function renderUpdateDto(
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

function renderEntity(names: ComponentNames): string {
  return `export class ${names.singularClassName} {\n  id = "";\n  name = "";\n}\n`;
}

function renderResourceTransport(
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

function renderResourceServiceSpec(names: ComponentNames): string {
  return `import { expect, test } from "bun:test";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\ntest("${names.className}Service creates and returns resources", () => {\n  const service = new ${names.className}Service();\n  const created = service.create({ name: "sample" });\n  expect(service.findOne(created.id)).toEqual(created);\n});\n`;
}

function renderResourceTransportSpec(names: ComponentNames, stem: string): string {
  const className = `${names.className}${pascalCase(stem)}`;
  return `import { expect, test } from "bun:test";\nimport { ${className} } from "./${names.fileName}.${stem}.ts";\nimport { ${names.className}Service } from "./${names.fileName}.service.ts";\n\ntest("${className} is defined", () => {\n  expect(new ${className}(new ${names.className}Service())).toBeDefined();\n});\n`;
}

function classSuffix(schematic: keyof typeof definitions): string {
  if (schematic === "class" || schematic === "provider" || schematic === "interface") {
    return "";
  }
  return pascalCase(schematic);
}

function symbolFor(schematic: GenerateSchematic, names: ComponentNames): string {
  if (schematic === "resource") return `${names.className}Module`;
  return `${names.className}${classSuffix(schematic as keyof typeof definitions)}`;
}

function registrationFor(schematic: GenerateSchematic): ModuleRegistrationKind | undefined {
  if (schematic === "resource") return "imports";
  if (schematic === "app" || schematic === "library") return undefined;
  return definitions[schematic].registration;
}

function primaryFile(files: readonly PendingFile[], schematic: GenerateSchematic): PendingFile {
  const expectedSuffix =
    schematic === "resource"
      ? ".module.ts"
      : definitions[schematic as keyof typeof definitions].suffix
        ? `.${definitions[schematic as keyof typeof definitions].suffix}.ts`
        : ".ts";
  return files.find(
    (file) => file.path.endsWith(expectedSuffix) && !file.path.endsWith(".spec.ts"),
  )!;
}

function resourceTransportStem(type: ResourceTransport): "controller" | "gateway" | "resolver" {
  if (type === "ws") return "gateway";
  if (type.startsWith("graphql")) return "resolver";
  return "controller";
}

function createFile(directory: string, name: string, content: string): PendingFile {
  return { path: join(directory, name), content, kind: "CREATE" };
}

async function readConfiguration(projectRoot: string): Promise<AponiaConfiguration> {
  const file = Bun.file(join(projectRoot, "aponia.json"));
  if (!(await file.exists())) {
    throw new Error('Could not find "aponia.json". Run the command from an Aponia project root.');
  }
  return (await file.json()) as AponiaConfiguration;
}

function resolveProject(
  configuration: AponiaConfiguration,
  requestedProject: string | undefined,
): {
  readonly root?: string;
  readonly sourceRoot?: string;
  readonly generateOptions?: GenerateDefaults;
} {
  if (!requestedProject) return {};
  const project = configuration.projects?.[requestedProject];
  if (!project) {
    throw new Error(`Unknown project "${requestedProject}" in aponia.json.`);
  }
  return {
    root: project.root,
    sourceRoot: project.sourceRoot ?? join(project.root ?? "", "src"),
    generateOptions: project.generateOptions,
  };
}

function readSpecDefault(
  value: GenerateDefaults["spec"],
  schematic: GenerateSchematic,
): boolean | undefined {
  if (typeof value === "boolean" || value === undefined) return value;
  return value[schematic];
}

function resolveInside(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Path "${path}" escapes the project root.`);
  }
  return resolved;
}

async function findModuleFile(options: {
  readonly projectRoot: string;
  readonly sourceRoot: string;
  readonly fromDirectory: string;
  readonly requestedModule?: string;
  readonly excludedFile?: string;
}): Promise<string | undefined> {
  if (options.requestedModule) {
    const candidates = await listModuleFiles(options.sourceRoot);
    const normalized = options.requestedModule.replace(/\.module(?:\.ts)?$/, "");
    const matches = candidates.filter((file) => {
      const relativeFile = relative(options.sourceRoot, file).replaceAll("\\", "/");
      return (
        relativeFile === `${normalized}.module.ts` ||
        relativeFile.endsWith(`/${normalized}.module.ts`)
      );
    });
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `Could not find module "${options.requestedModule}".`
          : `Module "${options.requestedModule}" is ambiguous.`,
      );
    }
    return matches[0];
  }

  let directory = options.fromDirectory;
  while (directory === options.sourceRoot || directory.startsWith(`${options.sourceRoot}${sep}`)) {
    const entries = await safeReadDirectory(directory);
    const modules = entries
      .filter((entry) => entry.endsWith(".module.ts"))
      .map((entry) => join(directory, entry))
      .filter((file) => file !== options.excludedFile)
      .toSorted();
    if (modules.length > 0) return modules[0];
    if (directory === options.sourceRoot) break;
    directory = dirname(directory);
  }
  return undefined;
}

async function listModuleFiles(directory: string): Promise<string[]> {
  return findFiles("**/*.module.ts", {
    absolute: true,
    cwd: directory,
    onlyFiles: true,
  });
}

async function safeReadDirectory(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

function toImportPath(moduleFile: string, generatedFile: string): string {
  let path = relative(dirname(moduleFile), generatedFile).replaceAll("\\", "/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}
