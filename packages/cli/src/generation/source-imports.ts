import { dirname, resolve } from "node:path";
import { Node, Project, type Identifier, type SourceFile } from "ts-morph";
import type { SourceImport, SourceImports, SourceImportsReading } from "./source-imports.types.ts";

/**
 * Reads the names a build-time analysis can substitute into generated source.
 *
 * Generation copies the expressions an application wrote — a provider call, a
 * route schema — into a module somewhere else in the project, so every name
 * those expressions read has to be resolvable from where the generated module
 * will live. This module answers the two halves of that question: which names a
 * file can read at all, and which names one expression reads.
 *
 * The namespace of resolvable names is deliberately narrow. A file's imports
 * count, and so do the declarations the file exports itself, because a generated
 * module can import either. A local binding that is not exported does not: its
 * value is whatever the owning file computed, and nothing can name it from
 * outside. An expression that reads one is reported as unreadable rather than
 * guessed at, and its consumer declines the declaration that contains it.
 */
export function readSourceImports(sourceFile: SourceFile): SourceImports {
  const ownerFile = sourceFile.getFilePath();
  const imports = new Map<string, SourceImport>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = resolveSpecifier(declaration.getModuleSpecifierValue(), ownerFile);
    const typeOnly = declaration.isTypeOnly();

    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) {
      setImport(imports, {
        name: defaultImport.getText(),
        exportedName: "default",
        specifier,
        form: "default",
        kind: typeOnly ? "type" : "value",
      });
    }

    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) {
      setImport(imports, {
        name: namespaceImport.getText(),
        exportedName: namespaceImport.getText(),
        specifier,
        form: "namespace",
        kind: typeOnly ? "type" : "value",
      });
    }

    for (const namedImport of declaration.getNamedImports()) {
      setImport(imports, {
        name: namedImport.getAliasNode()?.getText() ?? namedImport.getName(),
        exportedName: namedImport.getName(),
        specifier,
        form: "named",
        kind: typeOnly || namedImport.isTypeOnly() ? "type" : "value",
      });
    }
  }

  for (const declaration of sourceFile.getClasses()) {
    addLocalExport(imports, declaration, ownerFile);
  }
  for (const declaration of sourceFile.getFunctions()) {
    addLocalExport(imports, declaration, ownerFile);
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    addLocalExport(imports, declaration, ownerFile);
  }

  return imports;
}

/**
 * Reads the names one expression reads, and whether a generated module could use
 * the same expression.
 *
 * Every name the expression reads has to resolve to a name the owning file can
 * import: anything else would be written into a module that cannot see it. A
 * name that resolves to a type-only binding is only readable in a type position,
 * because `import type` cannot carry a value.
 *
 * @param node - The expression to read.
 * @param imports - The owning file's resolvable names, from {@link readSourceImports}.
 * @param description - How to name the expression in a reported reason.
 */
export function readExpressionImports(
  node: Node,
  imports: SourceImports,
  description: string,
): SourceImportsReading {
  const references: SourceImport[] = [];
  const seen = new Set<string>();
  let unreadable: string | undefined;

  const visit = (identifier: Identifier): void => {
    const name = identifier.getText();
    if (seen.has(name)) {
      return;
    }
    seen.add(name);

    const sourceImport = imports.get(name);
    if (sourceImport === undefined) {
      unreadable ??=
        `${description} reads "${name}", which is not an import or an export of the file it was ` +
        `written in, so a generated module cannot name it.`;
      return;
    }
    if (sourceImport.kind === "type" && !isTypePosition(identifier)) {
      unreadable ??= `${description} reads "${name}" as a value, but the file imports it as a type.`;
      return;
    }

    references.push(sourceImport);
  };

  walkNames(node, new Set(), visit);

  return Object.freeze({ references: Object.freeze(references), unreadable });
}

/** Parses one file's text and reads the names it can read. */
export function collectSourceImports(source: string, filePath: string): SourceImports {
  const project = new Project({ useInMemoryFileSystem: true });
  return readSourceImports(project.createSourceFile(filePath, source));
}

// One project, reused for every expression a build copies: a build copies a
// provider call and a schema slot for every route it reads, and a project per
// expression would pay for a parser start each time.
const expressionProject = new Project({ useInMemoryFileSystem: true });
let expressionCount = 0;

/**
 * Parses one expression's source text back into a node.
 *
 * An expression copied out of a file is text, and what a generated module has
 * to import for it depends on which identifiers it reads as names — a question
 * only a parsed node can answer, and the same one this module answers for the
 * analysis. The text is parsed as one parenthesized statement, which accepts
 * every expression a source file can hold, including an object literal that
 * would otherwise read as a block; the parentheses are then unwrapped, because
 * the callers ask what the text itself is — whether a bare identifier is an
 * identifier, for instance — and a wrapper node would answer for the wrapper.
 */
export function parseSourceExpression(text: string): Node {
  expressionCount += 1;
  const sourceFile = expressionProject.createSourceFile(
    `expression-${expressionCount}.ts`,
    `(${text});`,
  );
  const statement = sourceFile.getStatements()[0];
  if (statement === undefined || !Node.isExpressionStatement(statement)) {
    return sourceFile;
  }

  const expression = statement.getExpression();
  return Node.isParenthesizedExpression(expression) ? expression.getExpression() : expression;
}

/**
 * A relative specifier is resolved against the owning file's directory so the
 * record stays usable from a generated file elsewhere; a bare one is the
 * toolchain's to resolve and is kept as written.
 */
function resolveSpecifier(specifier: string, ownerFile: string): string {
  return specifier.startsWith(".") ? resolve(dirname(ownerFile), specifier) : specifier;
}

function setImport(imports: Map<string, SourceImport>, sourceImport: SourceImport): void {
  imports.set(sourceImport.name, Object.freeze(sourceImport));
}

/**
 * Records a declaration the file exports, so a generated module can import it
 * back from here. A declaration that is not exported is not recorded: nothing
 * outside the file can name it.
 */
function addLocalExport(
  imports: Map<string, SourceImport>,
  declaration: {
    readonly isExported: () => boolean;
    readonly isDefaultExport: () => boolean;
    readonly getName: () => string | undefined;
  },
  ownerFile: string,
): void {
  const name = declaration.getName();
  if (name === undefined || !declaration.isExported()) {
    return;
  }

  const isDefault = declaration.isDefaultExport();
  setImport(imports, {
    name,
    exportedName: isDefault ? "default" : name,
    specifier: ownerFile,
    form: isDefault ? "default" : "named",
    kind: "value",
  });
}

/**
 * Visits every identifier an expression reads as a name.
 *
 * `bound` carries the names a binding inside the expression already claims, so a
 * name a local declaration shadows is not mistaken for one the generated module
 * has to import. Only declarations that enclose the identifier are added, never
 * siblings, because claiming too much would drop an import the copy still needs.
 */
function walkNames(
  node: Node,
  bound: ReadonlySet<string>,
  visit: (identifier: Identifier) => void,
): void {
  if (Node.isIdentifier(node)) {
    if (!bound.has(node.getText()) && readsAsName(node)) {
      visit(node);
    }
    return;
  }

  // A property access reads its target and names its member: `t.Object` reads
  // the binding `t`, and `Object` is not a name this file can import.
  if (Node.isPropertyAccessExpression(node)) {
    walkNames(node.getExpression(), bound, visit);
    return;
  }
  if (Node.isQualifiedName(node)) {
    walkNames(node.getLeft(), bound, visit);
    return;
  }

  if (Node.isFunctionLikeDeclaration(node)) {
    const inner = collectBoundNames(node.getParameters(), bound);
    for (const parameter of node.getParameters()) {
      walk(parameter.getTypeNode(), inner, visit);
      walk(parameter.getInitializer(), inner, visit);
    }
    walk(node.getReturnTypeNode(), inner, visit);
    walk(functionBody(node), inner, visit);
    return;
  }

  if (Node.isVariableDeclaration(node)) {
    const inner = new Set(bound);
    for (const name of bindingNames(node.getNameNode())) {
      inner.add(name);
    }
    walk(node.getTypeNode(), inner, visit);
    walk(node.getInitializer(), inner, visit);
    return;
  }

  let effective = bound;
  if (Node.isCatchClause(node)) {
    const inner = new Set(bound);
    for (const name of bindingNames(node.getVariableDeclaration()?.getNameNode())) {
      inner.add(name);
    }
    effective = inner;
  }

  for (const child of node.getChildren()) {
    walkNames(child, effective, visit);
  }
}

/** Walks a node that may be absent, which a parameter or variable declaration often is. */
function walk(
  node: Node | undefined,
  bound: ReadonlySet<string>,
  visit: (identifier: Identifier) => void,
): void {
  if (node !== undefined) {
    walkNames(node, bound, visit);
  }
}

/**
 * The body of a function-like node, if it has one.
 *
 * ts-morph splits body access across two mixins that the narrowed
 * `FunctionLikeDeclaration` interface carries neither of: `BodyableNode`, for
 * declarations whose body may be absent, and `BodiedNode`, for the two whose body
 * is required. A function-like node always has one of them, and the branch above
 * has already returned for everything that is neither.
 */
function functionBody(node: Node): Node | undefined {
  return Node.isBodyable(node) || Node.isBodied(node) ? node.getBody() : undefined;
}

function collectBoundNames(
  parameters: readonly { getNameNode(): Node }[],
  bound: ReadonlySet<string>,
): Set<string> {
  const inner = new Set(bound);
  for (const parameter of parameters) {
    for (const name of bindingNames(parameter.getNameNode())) {
      inner.add(name);
    }
  }
  return inner;
}

/**
 * The names a binding pattern claims. A property name is skipped: in
 * `{ body: input }` the file binds `input`, and `body` names a property of the
 * value being destructured.
 */
function bindingNames(node: Node | undefined): readonly string[] {
  if (node === undefined || Node.isOmittedExpression(node)) {
    return [];
  }
  if (Node.isIdentifier(node)) {
    return [node.getText()];
  }
  if (Node.isBindingElement(node)) {
    return bindingNames(node.getNameNode());
  }
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node.getElements().flatMap((element) => bindingNames(element));
  }

  return [];
}

/**
 * Whether an identifier is a name the expression reads rather than a name being
 * declared. A property assignment's key, a member name, and a label are all
 * written like an identifier but read nothing; a shorthand property `{ name }`
 * is the exception and does read the outer binding.
 */
function readsAsName(identifier: Identifier): boolean {
  const parent = identifier.getParent();
  if (Node.isPropertyAssignment(parent) || Node.isPropertySignature(parent)) {
    return parent.getNameNode() !== identifier;
  }
  if (Node.isPropertyDeclaration(parent)) {
    return parent.getNameNode() !== identifier;
  }
  if (Node.isMethodDeclaration(parent) || Node.isMethodSignature(parent)) {
    return parent.getNameNode() !== identifier;
  }
  if (Node.isGetAccessorDeclaration(parent) || Node.isSetAccessorDeclaration(parent)) {
    return parent.getNameNode() !== identifier;
  }
  if (Node.isEnumMember(parent)) {
    return parent.getNameNode() !== identifier;
  }
  if (Node.isLabeledStatement(parent)) {
    return parent.getLabel() !== identifier;
  }
  if (Node.isBreakStatement(parent) || Node.isContinueStatement(parent)) {
    return parent.getLabel() !== identifier;
  }

  return true;
}

/** Whether an identifier sits inside a type, where a type-only binding is readable. */
function isTypePosition(identifier: Identifier): boolean {
  return identifier.getAncestors().some((ancestor) => Node.isTypeNode(ancestor));
}
