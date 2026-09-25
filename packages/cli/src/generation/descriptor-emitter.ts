import { isAbsolute } from "node:path";
import { Node } from "ts-morph";
import { toImportPath } from "./project-configuration.ts";
import { parseSourceExpression, readExpressionImports } from "./source-imports.ts";
import type { AnalyzedController, AnalyzedRoute } from "./controller-routes.types.ts";
import type {
  AnalyzedConstructorDependency,
  AnalyzedInjectedDependency,
  AnalyzedModule,
  AnalyzedModuleEntry,
  AnalyzedTypedDependency,
} from "./module-descriptors.types.ts";
import type {
  SourceImport,
  SourceImportForm,
  SourceImportKind,
  SourceImports,
} from "./source-imports.types.ts";
import type {
  DeclinedDescriptor,
  DeclinedRouteDescriptor,
  DescriptorSourceFile,
  EmittedModuleDescriptors,
} from "./descriptor-emitter.types.ts";

/**
 * The file a build writes, relative to the configured source root. It is a
 * fixed name so an application's entrypoint can import it without configuration.
 */
export const descriptorModuleFileName = "descriptors.generated.ts";

const aponiaModuleSpecifier = "@aponiajs/common";
const platformModuleSpecifier = "@aponiajs/platform-elysia";
const defineModuleName = "defineModule";
const defineControllerRoutesName = "defineElysiaControllerRoutes";
const provideClassName = "provideClass";

/**
 * Every helper a generated module calls, by name.
 *
 * The three are the constants above, and the type exists so the helper-to-module
 * lookup below is total: a generated file imports exactly the helpers its body
 * calls, and a name outside this union would have no module to import from.
 */
type DescriptorHelper =
  | typeof defineControllerRoutesName
  | typeof defineModuleName
  | typeof provideClassName;

/**
 * The module each helper is imported from.
 *
 * `defineModule` and the provider helpers are `@aponiajs/common` contracts, but
 * `defineElysiaControllerRoutes` is the platform's own descriptor authoring
 * surface, because compiling a declared controller into native routes is the
 * platform's job. A generated file therefore imports from both packages, which an
 * application booting through `AponiaFactory.create` already depends on.
 */
const helperSpecifiers: Readonly<Record<DescriptorHelper, string>> = {
  [defineModuleName]: aponiaModuleSpecifier,
  [defineControllerRoutesName]: platformModuleSpecifier,
  [provideClassName]: aponiaModuleSpecifier,
};

/**
 * The suffix on the module descriptor constant a generated module declares.
 *
 * A module's `imports` entry names a module class, and a generated module cannot
 * name that class back — the class it was lowered from is exactly what the
 * application stops booting through. The descriptor constant is what it names
 * instead, and the suffix is what keeps the constant from colliding with a
 * declaration of the same name.
 */
const descriptorSuffix = "Descriptor";

/**
 * The name the generated module exports its record of descriptors under. It is
 * reserved for the same reason the helper names are.
 */
const moduleDescriptorsName = "moduleDescriptors";

/**
 * A module class the emitter read, and the names its own file can read.
 *
 * The file's resolvable names travel with the declaration because every
 * expression the emitter copies — a provider call, a schema slot — has to be
 * imported from where that file imported it.
 */
interface ModuleDeclaration {
  readonly name: string;
  readonly file: string;
  readonly imports: SourceImports;
  readonly module: AnalyzedModule;
}

/** A `@Controller()` class, with the routes and the dependencies normally read from metadata. */
interface ControllerDeclaration {
  readonly name: string;
  readonly file: string;
  readonly imports: SourceImports;
  readonly path: string;
  readonly dependencies: readonly AnalyzedConstructorDependency[];
  /** Why the analysis could not read the class whole, or empty when it did. */
  readonly unreadable: readonly string[];
  readonly routes: readonly AnalyzedRoute[];
}

/** An `@Injectable()` or `@WebSocketGateway()` class, whose provider token is the class itself. */
interface ProviderDeclaration {
  readonly name: string;
  readonly file: string;
  readonly imports: SourceImports;
  readonly dependencies: readonly AnalyzedConstructorDependency[];
  /** Why the analysis could not read the class whole, or empty when it did. */
  readonly unreadable: readonly string[];
}

/**
 * Every declaration this build read, keyed by class name.
 *
 * A name two declarations share is left out of the lookup maps and recorded in
 * `duplicates` instead: a generated module addresses a class by name, so two
 * classes with one name cannot both be addressed, and picking one would be a
 * guess.
 */
interface ProjectCatalog {
  readonly modules: readonly ModuleDeclaration[];
  readonly controllerByName: ReadonlyMap<string, ControllerDeclaration>;
  readonly providerByName: ReadonlyMap<string, ProviderDeclaration>;
  readonly duplicates: ReadonlySet<string>;
}

/** One name a generated module has to import, resolved from where it will live. */
interface ModuleImport {
  readonly name: string;
  readonly exportedName: string;
  readonly specifier: string;
  readonly form: SourceImportForm;
  readonly kind: SourceImportKind;
}

/** A module the emitter could declare, in the pieces it renders from. */
interface ModulePlan {
  readonly declaration: ModuleDeclaration;
  /** The names the module's body reads, in first-use order. */
  readonly references: readonly ModuleImport[];
  /** The names of the modules this one imports, which have to be declared before it. */
  readonly dependencies: readonly string[];
  /** The helpers the body calls, so an unused one is never imported. */
  readonly helpers: ReadonlySet<DescriptorHelper>;
  /** The lines of the `defineModule({ ... })` body, without the call itself. */
  readonly body: readonly string[];
}

/** A rendered declaration, or why it could not be rendered. */
type Emission =
  | { readonly kind: "source"; readonly source: string }
  | { readonly kind: "declined"; readonly reason: string };

/** A copied expression and the names a generated module has to import for it. */
type ExpressionEmission =
  | {
      readonly kind: "source";
      readonly source: string;
      readonly references: readonly ModuleImport[];
    }
  | { readonly kind: "declined"; readonly reason: string };

/** A rendered provider, and the helpers rendering it calls. */
type ProviderEmission =
  | {
      readonly kind: "source";
      readonly source: string;
      readonly helpers: readonly DescriptorHelper[];
    }
  | { readonly kind: "declined"; readonly reason: string };

type PlannedModule =
  | { readonly kind: "plan"; readonly plan: ModulePlan }
  | { readonly kind: "declined"; readonly reason: string };

type ReferenceReading =
  | { readonly kind: "reference"; readonly reference: SourceImport }
  | { readonly kind: "declined"; readonly reason: string };

/**
 * Emits a module that declares an application's module graph as data.
 *
 * The runtime lowers decorated classes into descriptors by reading
 * `reflect-metadata`, and that lowering is most of what an application does
 * before it can serve a request. This emitter writes the same descriptors as
 * literal source instead, so an application can boot without anyone reading
 * decorator metadata: `defineModule` and `defineElysiaControllerRoutes` are the
 * platform's own descriptor authoring surface, and the generated module is
 * nothing more than a caller of them.
 *
 * The emitter covers what it can prove and declines the rest, exactly as the
 * invoker emitter does. A module whose declaration cannot be fully read, a
 * module that imports a module this build did not lower, and a module declaring
 * a route the emitter cannot state are all left out and reported: a controller
 * is declared whole, so emitting it without one of its routes would replace the
 * handler's answer with the platform's 404. A module left out of the generated
 * file keeps booting from its decorators, which is why a partial generated
 * module is a supported state rather than a broken one.
 *
 * Nothing here runs the application. Every decision comes from the source the
 * analysis already read, so a class that only exists after a side effect is
 * invisible, and a provider factory is never called.
 *
 * @param files - One entry per source file the build read.
 * @param generatedFile - The path the module will be written to, which decides
 *   the specifier a copied import is rewritten to.
 */
export function emitModuleDescriptors(
  files: readonly DescriptorSourceFile[],
  generatedFile: string,
): EmittedModuleDescriptors {
  const catalog = readCatalog(files);
  const declined: DeclinedDescriptor[] = [];
  const plans = new Map<string, ModulePlan>();

  for (const declaration of catalog.modules) {
    if (declaration.name.length === 0) {
      declined.push(
        moduleDecline("", "the module class is anonymous, so a generated module cannot key it"),
      );
      continue;
    }
    if (catalog.duplicates.has(declaration.name)) {
      declined.push(
        moduleDecline(
          declaration.name,
          `two classes in the project are named "${declaration.name}", and a generated module addresses each module by that name`,
        ),
      );
      continue;
    }

    const planned = planModule(declaration, catalog, generatedFile, declined);
    if (planned.kind === "declined") {
      declined.push(moduleDecline(declaration.name, planned.reason));
      continue;
    }

    plans.set(declaration.name, planned.plan);
  }

  const ordered = orderEmittableModules(plans, declined);
  if (ordered.length === 0) {
    return Object.freeze({ source: undefined, declined: Object.freeze(declined) });
  }

  return Object.freeze({
    source: renderModuleFile(ordered),
    declined: Object.freeze(declined),
  });
}

/**
 * Reads every file's declarations into one catalog.
 *
 * Both analyses the emitter consumes run per file and know nothing of the
 * others, while a generated module is one flat file, so this is where the two
 * collide: a class name that appears twice anywhere is recorded as ambiguous
 * rather than resolved by file order.
 */
function readCatalog(files: readonly DescriptorSourceFile[]): ProjectCatalog {
  const modules: ModuleDeclaration[] = [];
  const moduleNames = new Set<string>();
  const controllerByName = new Map<string, ControllerDeclaration>();
  const providerByName = new Map<string, ProviderDeclaration>();
  const duplicates = new Set<string>();

  const add = <T>(map: Map<string, T>, name: string, declaration: T): void => {
    if (name.length === 0) {
      return;
    }
    if (map.has(name)) {
      map.delete(name);
      duplicates.add(name);
      return;
    }
    if (!duplicates.has(name)) {
      map.set(name, declaration);
    }
  };

  for (const file of files) {
    for (const module of file.descriptors.modules) {
      // A module name is not a lookup the emitter resolves; it is the constant
      // declared for it and the key it is recorded under, so two classes sharing
      // one name would be declared twice in one file.
      if (moduleNames.has(module.className)) {
        duplicates.add(module.className);
      }
      moduleNames.add(module.className);
      modules.push({ name: module.className, file: file.file, imports: file.imports, module });
    }

    for (const declaration of file.descriptors.controllers) {
      const controller: AnalyzedController | undefined = file.controllers.find(
        (entry) => entry.className === declaration.className,
      );
      if (controller === undefined) {
        continue;
      }
      add(controllerByName, declaration.className, {
        name: declaration.className,
        file: file.file,
        imports: file.imports,
        path: controller.path,
        dependencies: declaration.dependencies,
        unreadable: declaration.unreadable,
        routes: controller.routes,
      });
    }

    for (const dependency of [...file.descriptors.injectables, ...file.descriptors.gateways]) {
      add(providerByName, dependency.className, {
        name: dependency.className,
        file: file.file,
        imports: file.imports,
        dependencies: dependency.dependencies,
        unreadable: dependency.unreadable,
      });
    }
  }

  return {
    modules: Object.freeze(modules),
    controllerByName,
    providerByName,
    duplicates,
  };
}

/** Reads one `@Module()` class into the pieces a generated module is rendered from. */
function planModule(
  declaration: ModuleDeclaration,
  catalog: ProjectCatalog,
  generatedFile: string,
  declined: DeclinedDescriptor[],
): PlannedModule {
  const reason = readCollectionReason(declaration.module);
  if (reason !== undefined) {
    return declinedResult(reason);
  }

  const references: ModuleImport[] = [];
  const dependencies: string[] = [];
  const helpers = new Set<DescriptorHelper>([defineModuleName]);

  const importedModules: string[] = [];
  for (const entry of declaration.module.imports) {
    const reading = readEntryReference(entry, declaration, "imports");
    if (reading.kind === "declined") {
      return reading;
    }

    const imported = catalog.modules.find(
      (module) => module.name === reading.reference.exportedName,
    );
    if (imported === undefined) {
      return declinedResult(
        unknownDeclarationReason(catalog, declaration, "imports", reading.reference.exportedName),
      );
    }

    importedModules.push(`${imported.name}${descriptorSuffix}`);
    dependencies.push(imported.name);
  }

  const controllerBlocks: string[] = [];
  for (const entry of declaration.module.controllers) {
    const reading = readEntryReference(entry, declaration, "controllers");
    if (reading.kind === "declined") {
      return reading;
    }

    const controller = catalog.controllerByName.get(reading.reference.exportedName);
    if (controller === undefined) {
      return declinedResult(
        unknownDeclarationReason(
          catalog,
          declaration,
          "controllers",
          reading.reference.exportedName,
        ),
      );
    }

    references.push(resolveReference(reading.reference, generatedFile));
    helpers.add(defineControllerRoutesName);

    const rendered = renderController(
      controller,
      reading.reference.name,
      generatedFile,
      references,
      declined,
      declaration.name,
    );
    if (rendered.kind === "declined") {
      return rendered;
    }
    controllerBlocks.push(rendered.source);
  }

  const providerBlocks: string[] = [];
  for (const entry of declaration.module.providers) {
    const rendered = renderProvider(entry, declaration, catalog, generatedFile, references);
    if (rendered.kind === "declined") {
      return rendered;
    }
    providerBlocks.push(rendered.source);
    for (const helper of rendered.helpers) {
      helpers.add(helper);
    }
  }

  const exportedNames: string[] = [];
  for (const entry of declaration.module.exports) {
    const reading = readEntryReference(entry, declaration, "exports");
    if (reading.kind === "declined") {
      return reading;
    }
    references.push(resolveReference(reading.reference, generatedFile));
    exportedNames.push(reading.reference.name);
  }

  const body: string[] = [`id: ${JSON.stringify(declaration.name)},`];
  if (importedModules.length > 0) {
    body.push(...renderCollection("imports", importedModules));
  }
  if (controllerBlocks.length > 0) {
    body.push(...renderCollection("controllers", controllerBlocks));
  }
  if (providerBlocks.length > 0) {
    body.push(...renderCollection("providers", providerBlocks));
  }
  if (exportedNames.length > 0) {
    body.push(...renderCollection("exports", exportedNames));
  }

  return {
    kind: "plan",
    plan: {
      declaration,
      references: Object.freeze(references),
      dependencies: Object.freeze(dependencies),
      helpers,
      body: Object.freeze(body),
    },
  };
}

/**
 * Why a module's own collections cannot be lowered, or `undefined` when they can.
 *
 * Only the collections are checked. `AnalyzedModule.unreadable` also repeats the
 * reasons the module class's own constructor dependencies carry, and the
 * container never resolves a module class — treating those reasons as
 * disqualifying would decline a module that boots perfectly well. So the check
 * reads `collectionUnreadable`, which the analysis fills with the collections'
 * own reasons and the reason each unreadable element carries.
 */
function readCollectionReason(module: AnalyzedModule): string | undefined {
  return module.collectionUnreadable[0];
}

/**
 * Reads one collection entry as the name a generated module can import.
 *
 * `@Module()` accepts whole expressions for a provider, and the emitter copies
 * those verbatim, but every collection keyed by a class or a token — imports,
 * controllers, exports — has to be a bare identifier. Anything else is a value
 * the build would have to re-derive, which is exactly the kind of computation
 * that cannot be read statically.
 */
function readEntryReference(
  entry: AnalyzedModuleEntry,
  declaration: { readonly file: string; readonly imports: SourceImports },
  collection: string,
): ReferenceReading {
  const description = `The "${collection}" entry "${entry.expression}" in ${declaration.file}`;
  const node = parseSourceExpression(entry.expression);
  if (!Node.isIdentifier(node) || node.getText() !== entry.expression) {
    return declinedResult(
      `${description} must name its declaration with a single identifier to be lowered into a generated module.`,
    );
  }

  const reference = declaration.imports.get(entry.expression);
  if (reference === undefined) {
    return declinedResult(
      `${description} names "${entry.expression}", which is not an import or an export of the file it was written in.`,
    );
  }
  if (reference.kind === "type") {
    return declinedResult(
      `${description} reads "${entry.expression}" as a value, but the file imports it as a type.`,
    );
  }

  return { kind: "reference", reference };
}

/**
 * Renders one declared controller through `defineElysiaControllerRoutes`.
 *
 * The declared path is the decorator's own path, and the routes carry the facts
 * decorators read out of emitted metadata — the parameter bindings, whether a
 * handler with no decorated parameter takes the context, whether the route is
 * Promise-capable — so a declared controller reaches the platform's route
 * compiler with everything a decorated one had.
 *
 * `name` is the name the owning module's file knows the controller by, which is
 * what the generated module imports it as.
 */
function renderController(
  controller: ControllerDeclaration,
  name: string,
  generatedFile: string,
  references: ModuleImport[],
  declined: DeclinedDescriptor[],
  moduleName: string,
): Emission {
  const inject = renderDependencyTokens(
    controller,
    generatedFile,
    references,
    `The controller ${controller.name} in ${controller.file}`,
  );
  if (inject.kind === "declined") {
    return inject;
  }

  const routes: string[] = [];
  for (const route of controller.routes) {
    const rendered = renderRoute(
      route,
      controller,
      generatedFile,
      references,
      declined,
      moduleName,
    );
    if (rendered.kind === "declined") {
      return rendered;
    }
    routes.push(rendered.source);
  }

  return {
    kind: "source",
    source: [
      `${defineControllerRoutesName}(${name}, {`,
      `  path: ${JSON.stringify(controller.path)},`,
      `  inject: ${inject.source},`,
      ...renderCollection("routes", routes, 1),
      "})",
    ].join("\n"),
  };
}

/**
 * Renders one route plan, or declines it.
 *
 * A route that cannot be stated sinks the module declaring it, and it is
 * reported as a route because that is the declaration the application has to
 * change before the next build can generate the module.
 */
function renderRoute(
  route: AnalyzedRoute,
  controller: ControllerDeclaration,
  generatedFile: string,
  references: ModuleImport[],
  declined: DeclinedDescriptor[],
  moduleName: string,
): Emission {
  const schemaReason = route.schema?.unreadable;
  if (schemaReason !== undefined) {
    return declineRoute(declined, moduleName, controller, route, schemaReason);
  }

  // The property key is what the platform looks the handler up by, and the only
  // key a generated module can name is a plain one. A computed name reaches the
  // analysis as its own source text, which is not the key the runtime recorded.
  const propertyKey = readPropertyKey(route);
  if (propertyKey === undefined) {
    return declineRoute(
      declined,
      moduleName,
      controller,
      route,
      "the handler's name is not a plain property key, so a generated module cannot look it up",
    );
  }

  const fields: string[] = [
    `method: ${JSON.stringify(route.method)},`,
    `path: ${JSON.stringify(route.path)},`,
    `propertyKey: ${JSON.stringify(propertyKey)},`,
  ];

  if (route.parameters.length > 0) {
    fields.push(
      ...renderCollection(
        "parameters",
        route.parameters.map(
          (parameter) =>
            // `property` is required by the platform's parameter metadata even
            // when the decorator named no property, so it is written as
            // `undefined` rather than left out. Omitting it would make the
            // generated module fail the application's own type check, and the
            // runtime reads the same `undefined` either way.
            `{ index: ${parameter.index}, kind: ${JSON.stringify(parameter.kind)}, property: ` +
            `${parameter.property === undefined ? "undefined" : JSON.stringify(parameter.property)} }`,
        ),
      ),
    );
  } else if (route.declaresParameters || route.usesArgumentsObject) {
    // Omitting this would send the platform's whole-context fallback back to
    // reading the handler's own source, which is the inference a declared route
    // exists to remove.
    fields.push("takesContext: true,");
  }

  if (route.declaresSynchronousReturn) {
    fields.push("promiseCapable: false,");
  }

  if (route.schema !== undefined) {
    const slots: string[] = [];
    for (const slot of route.schema.slots) {
      const rendered = emitExpression(
        slot.expression,
        controller,
        generatedFile,
        `${description(controller, route)}'s "${slot.slot}" schema`,
      );
      if (rendered.kind === "declined") {
        return declineRoute(declined, moduleName, controller, route, rendered.reason);
      }
      references.push(...rendered.references);
      slots.push(`${slot.slot}: ${rendered.source}`);
    }
    fields.push(`schema: { ${slots.join(", ")} },`);
  }

  return { kind: "source", source: ["{", ...indentLines(fields, 1), "}"].join("\n") };
}

/**
 * Renders one provider entry.
 *
 * A bare class the build read is the case worth rewriting, and the runtime
 * lowers it by reflecting on the class — so the emitter writes the same
 * `provideClass` call with the dependencies the analysis read instead, which is
 * the reflection this artifact exists to remove.
 *
 * Everything else is copied verbatim, which is exactly what the runtime does with
 * it: `compileProvider` passes a provider value through unchanged, so a
 * `provideValue(...)` call, a factory result, or a class outside the project is
 * the same value in generated source once its names are imported. Copying is not
 * a guess — the runtime applies its own rule to the same expression either way —
 * and a name the copied expression reads that its file does not export is
 * reported instead.
 */
function renderProvider(
  entry: AnalyzedModuleEntry,
  declaration: ModuleDeclaration,
  catalog: ProjectCatalog,
  generatedFile: string,
  references: ModuleImport[],
): ProviderEmission {
  const description = `The "providers" entry "${entry.expression}" in ${declaration.file}`;
  const node = parseSourceExpression(entry.expression);
  const provider =
    Node.isIdentifier(node) && node.getText() === entry.expression
      ? catalog.providerByName.get(entry.expression)
      : undefined;

  if (provider === undefined) {
    const rendered = emitExpression(entry.expression, declaration, generatedFile, description);
    if (rendered.kind === "declined") {
      return rendered;
    }

    references.push(...rendered.references);
    return { kind: "source", source: rendered.source, helpers: [] };
  }

  const reference = provider.imports.get(provider.name);
  if (reference === undefined || reference.kind === "type") {
    return declinedResult(
      `${description} names "${provider.name}", which its own file does not export as a value.`,
    );
  }

  references.push(resolveReference(reference, generatedFile));
  const inject = renderDependencyTokens(
    provider,
    generatedFile,
    references,
    `The provider ${provider.name} in ${provider.file}`,
  );
  if (inject.kind === "declined") {
    return inject;
  }

  return {
    kind: "source",
    source: `${provideClassName}(${reference.name}, ${inject.source})`,
    helpers: [provideClassName],
  };
}

/**
 * Renders the token list a class's constructor dependencies resolve to.
 *
 * `@Inject()` names a token outright, and the declared type is what the runtime
 * falls back to through `design:paramtypes` — so both are stated, and both have
 * to name something the generated module can import as a value. A token built at
 * run time, such as `createToken(...)` inside a decorator, has no second copy to
 * make: calling the factory again would produce a token that is not the one the
 * application provides, so that class is declined rather than wired to nothing.
 *
 * The declaration's own reasons are read first, because a class that declares no
 * constructor but extends one has no dependency entries at all: its dependencies
 * are the base class's, which the analysis does not read, and the runtime reads
 * the same inherited `design:paramtypes`. Wiring an empty list there would hand
 * the container a different constructor call than the decorators do.
 */
function renderDependencyTokens(
  owner: {
    readonly dependencies: readonly AnalyzedConstructorDependency[];
    readonly unreadable: readonly string[];
    readonly file: string;
    readonly imports: SourceImports;
  },
  generatedFile: string,
  references: ModuleImport[],
  description: string,
): Emission {
  const unreadable = owner.unreadable[0];
  if (unreadable !== undefined) {
    return declinedResult(unreadable);
  }

  const tokens: string[] = [];

  for (const dependency of owner.dependencies.filter(isResolvableDependency)) {
    if (dependency.source === "inject") {
      if (dependency.token.kind === "injection-token") {
        return declinedResult(
          `${description} injects ${dependency.token.expression}, whose identity a generated module cannot reproduce; bind the token to a named constant and inject that.`,
        );
      }

      const injected = owner.imports.get(dependency.token.expression);
      if (injected === undefined || injected.kind === "type") {
        return declinedResult(
          `${description} injects "${dependency.token.expression}", which is not an import or an export of the file it was written in.`,
        );
      }

      references.push(resolveReference(injected, generatedFile));
      tokens.push(injected.name);
      continue;
    }

    const inherited = owner.imports.get(dependency.type);
    if (inherited === undefined || inherited.kind === "type") {
      return declinedResult(
        `${description} resolves the constructor parameter at index ${dependency.index} from the declared type "${dependency.type}", which a generated module cannot import as a value; annotate the parameter with @Inject() instead.`,
      );
    }

    references.push(resolveReference(inherited, generatedFile));
    tokens.push(inherited.name);
  }

  return { kind: "source", source: `[${tokens.join(", ")}]` };
}

/**
 * The dependencies the emitter can wire, for its type alone.
 *
 * Nothing is filtered out: the owning declaration's reasons are checked before
 * this runs, and the analysis repeats every unreadable dependency's reason
 * there, so a dependency that reached the loop is one the analysis resolved.
 */
function isResolvableDependency(
  dependency: AnalyzedConstructorDependency,
): dependency is AnalyzedInjectedDependency | AnalyzedTypedDependency {
  return dependency.source !== "unreadable";
}

/**
 * Reads one copied expression: what it reads, and why it cannot be copied.
 *
 * The names are read from the expression again rather than carried on the
 * analysis record, because one rule decides both — an expression the analysis
 * called readable is one whose every name resolves in the file it was written
 * in.
 */
function emitExpression(
  expression: string,
  declaration: { readonly file: string; readonly imports: SourceImports },
  generatedFile: string,
  description: string,
): ExpressionEmission {
  const reading = readExpressionImports(
    parseSourceExpression(expression),
    declaration.imports,
    description,
  );
  if (reading.unreadable !== undefined) {
    return declinedResult(reading.unreadable);
  }

  return {
    kind: "source",
    source: expression,
    references: Object.freeze(
      reading.references.map((reference) => resolveReference(reference, generatedFile)),
    ),
  };
}

/**
 * Orders the modules that can be emitted, and reports the ones that cannot.
 *
 * Three things decide whether a module can be written beside the others, and
 * each is a property of the file as a whole rather than of one module:
 *
 * - a module that imports a module this build did not lower has no descriptor to
 *   name, so it is dropped, and so is everything that imports it;
 * - two different declarations sharing one name cannot both be imported into one
 *   file, so every module needing that name is dropped;
 * - a module has to be declared before the modules importing it, because the
 *   descriptor constants are `const` bindings in one file. A cycle among them
 *   has no such order — and the application's own graph rejects it at boot — so
 *   its members are dropped too.
 *
 * The generated file also binds names of its own: the helpers it calls, the
 * constant it declares for each module, and the record it exports. An
 * application declaration wanting one of those names is dropped for the same
 * reason two declarations sharing a name are — one file cannot tell them apart.
 */
function orderEmittableModules(
  plans: ReadonlyMap<string, ModulePlan>,
  declined: DeclinedDescriptor[],
): readonly ModulePlan[] {
  const reserved = reservedNames(plans);
  const reachable = pruneUnemittable(plans, declined);
  const unambiguous = pruneAmbiguousNames(reachable, reserved, declined);

  const remaining = new Map(unambiguous);
  const ordered: ModulePlan[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((plan) =>
      plan.dependencies.every((dependency) => !remaining.has(dependency)),
    );
    if (ready.length === 0) {
      for (const plan of remaining.values()) {
        declined.push(
          moduleDecline(
            plan.declaration.name,
            "it takes part in a module import cycle, which has no declaration order in one generated file",
          ),
        );
      }
      break;
    }

    for (const plan of ready) {
      ordered.push(plan);
      remaining.delete(plan.declaration.name);
    }
  }

  return Object.freeze(ordered);
}

/** Every name the generated file binds for itself. */
function reservedNames(plans: ReadonlyMap<string, ModulePlan>): ReadonlySet<string> {
  const names = new Set<string>([moduleDescriptorsName]);
  for (const plan of plans.values()) {
    names.add(`${plan.declaration.name}${descriptorSuffix}`);
    for (const helper of plan.helpers) {
      names.add(helper);
    }
  }

  return names;
}

/** Drops every module that imports a module this build did not lower, transitively. */
function pruneUnemittable(
  plans: ReadonlyMap<string, ModulePlan>,
  declined: DeclinedDescriptor[],
): ReadonlyMap<string, ModulePlan> {
  const reachable = new Map(plans);
  while (true) {
    const dropped = [...reachable.values()].filter((plan) =>
      plan.dependencies.some((dependency) => !reachable.has(dependency)),
    );
    if (dropped.length === 0) {
      return reachable;
    }

    for (const plan of dropped) {
      const missing = plan.dependencies.find((dependency) => !reachable.has(dependency));
      declined.push(
        moduleDecline(
          plan.declaration.name,
          `it imports "${missing}", which this build did not lower into the generated module`,
        ),
      );
      reachable.delete(plan.declaration.name);
    }
  }
}

/** Drops every module needing a name two different declarations both claim. */
function pruneAmbiguousNames(
  plans: ReadonlyMap<string, ModulePlan>,
  reserved: ReadonlySet<string>,
  declined: DeclinedDescriptor[],
): ReadonlyMap<string, ModulePlan> {
  const byName = new Map<string, ModuleImport[]>();
  for (const plan of plans.values()) {
    for (const reference of plan.references) {
      const known = byName.get(reference.name);
      if (known === undefined) {
        byName.set(reference.name, [reference]);
      } else if (!known.some((entry) => sameImport(entry, reference))) {
        known.push(reference);
      }
    }
  }

  const ambiguous = new Set(
    [...byName]
      .filter(([name, entries]) => entries.length > 1 || reserved.has(name))
      .map(([name]) => name),
  );
  if (ambiguous.size === 0) {
    return plans;
  }

  const kept = new Map(plans);
  for (const plan of plans.values()) {
    const conflict = plan.references.find((reference) => ambiguous.has(reference.name));
    if (conflict === undefined) {
      continue;
    }
    declined.push(
      moduleDecline(
        plan.declaration.name,
        `it needs the name "${conflict.name}", which the generated file either binds for itself or binds to two different declarations`,
      ),
    );
    kept.delete(plan.declaration.name);
  }

  return kept;
}

/** Renders the whole generated file: its imports, its module constants, and the record of them. */
function renderModuleFile(ordered: readonly ModulePlan[]): string {
  const lines: string[] = [
    "// Generated by @aponiajs/cli. Do not edit.",
    ...renderImports(ordered),
  ];

  for (const plan of ordered) {
    lines.push(
      "",
      `const ${plan.declaration.name}${descriptorSuffix} = ${defineModuleName}({`,
      ...indentLines(plan.body, 1),
      "});",
    );
  }

  lines.push(
    "",
    "/**",
    " * Every module this build could declare, keyed by the module class name.",
    " *",
    " * Boot an application from one with `AponiaFactory.create(moduleDescriptors.X)`.",
    " * A module with no entry here still boots from its own decorators, which is",
    " * why a partially generated module is a supported state.",
    " */",
    `export const ${moduleDescriptorsName} = Object.freeze({`,
    ...ordered.map(
      (plan) => `  ${plan.declaration.name}: ${plan.declaration.name}${descriptorSuffix},`,
    ),
    "});",
    "",
  );

  return lines.join("\n");
}

/**
 * Renders the import block.
 *
 * The helper names come from the descriptor authoring packages and are written
 * only when a body calls them, so a module declaring no controller does not
 * import the controller helper. Every other name is one the application wrote,
 * rewritten to a specifier that resolves from where the generated file lives;
 * modules referring to the same declaration share one import, and a name bound
 * two different ways never reaches this point.
 */
function renderImports(ordered: readonly ModulePlan[]): readonly string[] {
  const helpers = [...new Set(ordered.flatMap((plan) => [...plan.helpers]))].toSorted();
  const references: ModuleImport[] = [];
  for (const plan of ordered) {
    for (const reference of plan.references) {
      if (!references.some((known) => sameImport(known, reference))) {
        references.push(reference);
      }
    }
  }

  const lines: string[] = [];
  for (const specifier of [aponiaModuleSpecifier, platformModuleSpecifier]) {
    const names = helpers.filter((helper) => helperSpecifiers[helper] === specifier);
    if (names.length > 0) {
      lines.push(`import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`);
    }
  }
  for (const reference of references) {
    lines.push(renderReferenceImport(reference));
  }

  return lines;
}

function renderReferenceImport(reference: ModuleImport): string {
  const specifier = JSON.stringify(reference.specifier);
  const typeOnly = reference.kind === "type" ? " type" : "";
  if (reference.form === "namespace") {
    return `import${typeOnly} * as ${reference.name} from ${specifier};`;
  }
  if (reference.form === "default") {
    return `import${typeOnly} ${reference.name} from ${specifier};`;
  }

  const imported =
    reference.name === reference.exportedName
      ? reference.name
      : `${reference.exportedName} as ${reference.name}`;
  return `import${typeOnly} { ${imported} } from ${specifier};`;
}

/**
 * Resolves one name for the file it will be written into.
 *
 * A relative specifier was already resolved against the file it was written in,
 * because that file's directory is the only place it means anything; from there
 * it is written relative to the generated file. A bare specifier is the
 * toolchain's to resolve and is kept as written.
 */
function resolveReference(reference: SourceImport, generatedFile: string): ModuleImport {
  return Object.freeze({
    name: reference.name,
    exportedName: reference.exportedName,
    specifier: isAbsolute(reference.specifier)
      ? toImportPath(generatedFile, reference.specifier)
      : reference.specifier,
    form: reference.form,
    kind: reference.kind,
  });
}

function sameImport(left: ModuleImport, right: ModuleImport): boolean {
  return (
    left.name === right.name &&
    left.exportedName === right.exportedName &&
    left.specifier === right.specifier &&
    left.form === right.form &&
    left.kind === right.kind
  );
}

/** Renders an array literal, indented one level per `level`, with every entry comma-terminated. */
function renderCollection(name: string, entries: readonly string[], level = 0): readonly string[] {
  return indentLines(
    [`${name}: [`, ...indentLines(entries.flatMap(commaTerminated), 1), "],"],
    level,
  );
}

function commaTerminated(entry: string): readonly string[] {
  const lines = entry.split("\n");
  return lines.map((line, index) => `${line}${index === lines.length - 1 ? "," : ""}`);
}

function indentLines(lines: readonly string[], level: number): readonly string[] {
  const prefix = "  ".repeat(level);
  return lines.map((line) => (line.length === 0 ? line : `${prefix}${line}`));
}

/**
 * The property key a generated plan can name.
 *
 * A method whose name is a computed key reaches the analysis as its own source
 * text — `[symbol]` — which is not the key the runtime recorded, and one whose
 * name is a string literal keeps its quotes. Neither can be written back as a
 * key, so the route is declined instead of bound to a key no handler has.
 */
function readPropertyKey(route: AnalyzedRoute): string | undefined {
  const key = parseSourceExpression(route.methodName);
  return Node.isIdentifier(key) && key.getText() === route.methodName
    ? route.methodName
    : undefined;
}

function declineRoute(
  declined: DeclinedDescriptor[],
  module: string,
  controller: ControllerDeclaration,
  route: AnalyzedRoute,
  reason: string,
): Emission {
  const descriptor: DeclinedRouteDescriptor = Object.freeze({
    kind: "route",
    module,
    controller: controller.name,
    method: route.methodName,
    reason,
  });
  declined.push(descriptor);
  return declinedResult(reason);
}

function description(controller: ControllerDeclaration, route: AnalyzedRoute): string {
  return `@${route.method} ${controller.name}.${route.methodName} in ${controller.file}`;
}

function moduleDecline(module: string, reason: string): DeclinedDescriptor {
  return Object.freeze({ kind: "module", module, reason });
}

function declinedResult(reason: string): { readonly kind: "declined"; readonly reason: string } {
  return { kind: "declined", reason };
}

/** Why a collection names a declaration this build cannot emit. */
function unknownDeclarationReason(
  catalog: ProjectCatalog,
  declaration: ModuleDeclaration,
  collection: string,
  name: string,
): string {
  return `The "${collection}" entry "${name}" in ${declaration.file} cannot be lowered: ${unknownReason(catalog, name)}.`;
}

function unknownReason(catalog: ProjectCatalog, name: string): string {
  return catalog.duplicates.has(name)
    ? `two classes in the project are named "${name}", and a generated module addresses each by that name`
    : `no declaration named "${name}" was read from the project's own source`;
}
