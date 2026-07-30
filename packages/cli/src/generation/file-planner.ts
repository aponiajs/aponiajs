import { join } from "node:path";
import { normalizeNameSegments } from "./component-names.ts";
import type { ComponentNames } from "./component-names.types.ts";
import { renderComponent, renderComponentSpec, renderSimpleSpec } from "./component-renderer.ts";
import { createFile } from "./file-writer.ts";
import {
  renderCreateDto,
  renderEntity,
  renderResourceController,
  renderResourceModel,
  renderResourceModule,
  renderResourceService,
  renderResourceServiceSpec,
  renderResourceTransport,
  renderResourceTransportSpec,
  renderUpdateDto,
} from "./resource-renderer.ts";
import { resourceTransportStem, schematicDefinitions } from "./schematic-definitions.ts";
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
        renderResourceTransportSpec(names, transportStem, options.crud),
      ),
    );
  }

  return files;
}
