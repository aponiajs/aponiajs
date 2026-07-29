import {
  IndentationText,
  Node,
  Project,
  QuoteKind,
  SyntaxKind,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import type { ModuleRegistrationKind } from "./module-registration.types.ts";

export function registerInModule(
  source: string,
  registrationKind: ModuleRegistrationKind,
  symbol: string,
  importPath: string,
): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Double,
    },
  });
  const sourceFile = project.createSourceFile("module.ts", source);
  const moduleMetadata = findModuleMetadata(sourceFile);
  if (!moduleMetadata) {
    throw new Error("The declaring module does not contain a @Module() metadata object.");
  }

  if (isAlreadyRegistered(sourceFile, registrationKind, symbol, importPath)) {
    return source;
  }

  addImport(sourceFile, symbol, importPath);
  addRegistration(moduleMetadata, registrationKind, symbol);
  return sourceFile.getFullText();
}

function findModuleMetadata(sourceFile: SourceFile): ObjectLiteralExpression | undefined {
  const moduleCall = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((callExpression) => callExpression.getExpression().getText() === "Module");
  const metadata = moduleCall?.getArguments()[0];
  return Node.isObjectLiteralExpression(metadata) ? metadata : undefined;
}

function isAlreadyRegistered(
  sourceFile: SourceFile,
  registrationKind: ModuleRegistrationKind,
  symbol: string,
  importPath: string,
): boolean {
  const hasImport = sourceFile
    .getImportDeclarations()
    .some(
      (declaration) =>
        declaration.getModuleSpecifierValue() === importPath &&
        declaration.getNamedImports().some((namedImport) => namedImport.getName() === symbol),
    );
  if (!hasImport) return false;

  const metadata = findModuleMetadata(sourceFile);
  const registration = metadata?.getProperty(registrationKind);
  if (!Node.isPropertyAssignment(registration)) return false;
  const initializer = registration.getInitializer();
  return (
    Node.isArrayLiteralExpression(initializer) &&
    initializer.getElements().some((element) => element.getText() === symbol)
  );
}

function addImport(sourceFile: SourceFile, symbol: string, importPath: string): void {
  const existingImport = sourceFile
    .getImportDeclarations()
    .find((declaration) => declaration.getModuleSpecifierValue() === importPath);
  if (existingImport) {
    if (!existingImport.getNamedImports().some((namedImport) => namedImport.getName() === symbol)) {
      existingImport.addNamedImport(symbol);
    }
    return;
  }

  sourceFile.addImportDeclaration({
    namedImports: [symbol],
    moduleSpecifier: importPath,
  });
}

function addRegistration(
  metadata: ObjectLiteralExpression,
  registrationKind: ModuleRegistrationKind,
  symbol: string,
): void {
  const registration = metadata.getProperty(registrationKind);
  if (!registration) {
    metadata.addPropertyAssignment({
      name: registrationKind,
      initializer: `[${symbol}]`,
    });
    return;
  }

  if (!Node.isPropertyAssignment(registration)) {
    throw new Error(`Module metadata "${registrationKind}" must be a property assignment.`);
  }
  const initializer = registration.getInitializer();
  if (!Node.isArrayLiteralExpression(initializer)) {
    throw new Error(`Module metadata "${registrationKind}" must be an array.`);
  }
  if (!initializer.getElements().some((element) => element.getText() === symbol)) {
    initializer.addElement(symbol);
  }
}
