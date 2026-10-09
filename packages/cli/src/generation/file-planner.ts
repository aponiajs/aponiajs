import { join } from "node:path";
import { normalizeNameSegments } from "./component-names.ts";
import type { ComponentNames } from "./component-names.types.ts";
import { renderComponent, renderComponentSpec, renderSimpleSpec } from "./component-renderer.ts";
import { createFile } from "./file-writer.ts";
import {
  renderCreateDto,
  renderEntity,
  renderGraphqlResolverScaffold,
  renderMicroserviceScaffold,
  renderResourceController,
  renderResourceModel,
  renderResourceModule,
  renderResourceService,
  renderResourceServiceSpec,
  renderUpdateDto,
  renderResourceTransportSpec,
  renderWebSocketGateway,
} from "./resource-renderer.ts";
import { schematicDefinitions } from "./schematic-definitions.ts";
import type {
  ComponentSchematic,
  GenerateSchematicOptions,
  PendingFile,
} from "./schematic.types.ts";

export function createComponentFiles(
  basePath: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
  specEnabled: boolean,
): PendingFile[] {
  const schematic = options.schematic as ComponentSchematic;
  const definition = schematicDefinitions[schematic];
  const flat = options.flat ?? definition.defaultFlat;
  const parentSegments = normalizeNameSegments(options.name).slice(0, -1);
  const directory = join(basePath, ...parentSegments, ...(flat ? [] : [names.fileName]));
  const stem = definition.suffix ? `${names.fileName}.${definition.suffix}` : names.fileName;
  const files: PendingFile[] = [
    createFile(directory, `${stem}.ts`, renderComponent(schematic, names)),
  ];

  if (definition.spec && specEnabled) {
    files.push(
      createFile(directory, `${stem}.spec.ts`, renderComponentSpec(schematic, names, stem)),
    );
  }

  return files;
}

export function createResourceFiles(
  basePath: string,
  names: ComponentNames,
  options: GenerateSchematicOptions,
  specEnabled: boolean,
): PendingFile[] {
  const flat = options.flat ?? false;
  const parentSegments = normalizeNameSegments(options.name).slice(0, -1);
  const directory = join(basePath, ...parentSegments, ...(flat ? [] : [names.fileName]));
  const dtoSuffix = options.type.startsWith("graphql") ? "input" : "dto";
  // The transport file's own stem: `rest` and `microservice` share the
  // controller stem (one mounted, one scaffold), `ws` is a gateway, and both
  // graphql transports are resolvers. Read from the `type` beside each branch
  // rather than from `resourceTransportStem`, whose `"controller" | "gateway"
  // | "resolver"` union cannot tell a mounted controller from a scaffold.
  const fileStem =
    options.type === "rest" || options.type === "microservice"
      ? "controller"
      : options.type === "ws"
        ? "gateway"
        : "resolver";
  const files: PendingFile[] = [
    createFile(directory, `${names.fileName}.module.ts`, renderResourceModule(names, options.type)),
    createFile(
      directory,
      `${names.fileName}.service.ts`,
      renderResourceService(names, options.crud, options.type),
    ),
  ];

  const restCrud = options.crud && options.type === "rest";
  if (restCrud) {
    files.push(createFile(directory, `${names.fileName}.model.ts`, renderResourceModel(names)));
  }

  if (options.crud && !restCrud) {
    files.push(
      createFile(
        join(directory, "dto"),
        `create-${names.singularFileName}.${dtoSuffix}.ts`,
        renderCreateDto(names, dtoSuffix),
      ),
      createFile(
        join(directory, "dto"),
        `update-${names.singularFileName}.${dtoSuffix}.ts`,
        renderUpdateDto(names, dtoSuffix),
      ),
    );
  }

  if (options.crud) {
    files.push(
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
  } else if (options.type === "ws") {
    files.push(
      createFile(
        directory,
        `${names.fileName}.gateway.ts`,
        renderWebSocketGateway(names, `${names.className}Gateway`, options.crud),
      ),
    );
  } else if (options.type === "microservice") {
    files.push(
      createFile(
        directory,
        `${names.fileName}.controller.ts`,
        renderMicroserviceScaffold(names, options.crud),
      ),
    );
  } else {
    files.push(
      createFile(
        directory,
        `${names.fileName}.resolver.ts`,
        renderGraphqlResolverScaffold(names, options.type, options.crud),
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
        `${names.fileName}.${fileStem}.spec.ts`,
        renderResourceTransportSpec(names, fileStem, options.crud),
      ),
    );
  }

  return files;
}
