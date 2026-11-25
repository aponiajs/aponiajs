/**
 * The starter's documentation is written for the application that mounts the
 * devtools surface. `--no-observe` removes that surface from the emitted module
 * and its dependency, so every generated file that described it is lowered to
 * what the project actually contains.
 *
 * A transform that cannot find its target throws rather than writing the file
 * unchanged: a template edit that forgot this seam would otherwise ship a
 * generated application whose own guide documents a module it does not have.
 *
 * @param relativeFile - The planned file, relative to the project root.
 * @param content - The rendered file.
 * @returns The file with the devtools references removed.
 */
export function stripDevtoolsDocumentation(relativeFile: string, content: string): string {
  switch (relativeFile) {
    case "README.md":
      return stripReadme(content);
    case "AGENTS.md":
      return stripAgentsGuide(content);
    case "llms.txt":
      return removeLines(content, ["- [Devtools](", "- [@aponiajs/devtools]("]);
    case ".env.example":
      return stripEnvironmentExample(content);
    case "src/logger.ts":
      return stripLoggerComment(content);
    default:
      return content;
  }
}

function stripReadme(content: string): string {
  const withoutArtifactClaim = replaceBetween(
    content,
    " The\ndescriptor artifact this starter commits also holds no declaration for",
    "still mounts the devtools surface.",
    "\nThe descriptor artifact this starter commits is empty, and the inspection\nthat hands it over reports the decorated graph until the first build fills it.",
  );
  const withoutSurface = removeParagraphs(
    withoutArtifactClaim,
    "`src/app.module.ts` imports `DevtoolsModule.forRoot(...)`",
    "is part of the graph.",
  );

  return replaceBetween(
    withoutSurface,
    "`src/logger.ts` holds the application's logger, and the same object goes to",
    "replacing it.",
    "`src/logger.ts` holds the application's logger, and the same object goes to\n`AponiaFactory.create` in `src/main.ts`, so every bootstrap line is written\nthrough the logger the application also holds.",
  );
}

function stripAgentsGuide(content: string): string {
  const withoutArtifactClaim = replaceBetween(
    content,
    "That artifact holds no declaration for `AppModule` in this starter, because",
    "without bundling.",
    "Both files are stamped with the framework release that wrote them, and the\ninspection refuses one from another release rather than using it, which costs the\noptimization and never a wrong answer. The committed descriptor artifact is\nempty, so the inspection reports the decorated graph until the first build fills\nit. `aponia build` writes the same two modules without bundling.",
  );

  return removeSection(withoutArtifactClaim, "## Devtools", "## Authoring rules");
}

function stripEnvironmentExample(content: string): string {
  const start = content.indexOf("\n\n# The devtools");
  if (start === -1) {
    throw new Error("The no-observe .env.example transform no longer finds its devtools block.");
  }
  return `${content.slice(0, start)}\n`;
}

function stripLoggerComment(content: string): string {
  const start = content.indexOf("/**");
  const end = content.indexOf("*/", start);
  if (start === -1 || end === -1) {
    throw new Error("The no-observe logger transform no longer finds its documentation block.");
  }

  const replacement = `/**
 * The application's logger.
 *
 * \`AponiaFactory.create\` writes every bootstrap line — the modules it
 * initialized, the routes it resolved — through the logger it is handed.
 *
 * Replace it with your own \`LoggerService\` when the application should log
 * somewhere else.
 */`;

  return content.slice(0, start) + replacement + content.slice(end + 2);
}

function removeLines(content: string, prefixes: readonly string[]): string {
  return content
    .split("\n")
    .filter((line) => !prefixes.some((prefix) => line.startsWith(prefix)))
    .join("\n");
}

function removeSection(content: string, heading: string, nextHeading: string): string {
  const start = content.indexOf(heading);
  const end = content.indexOf(nextHeading, start);
  if (start === -1 || end === -1) {
    throw new Error(
      `The no-observe guide transform no longer finds the "${heading}" section it removes.`,
    );
  }
  return content.slice(0, start) + content.slice(end);
}

function removeParagraphs(content: string, start: string, end: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(
      "The no-observe README transform no longer finds the devtools surface section.",
    );
  }

  const before = content.slice(0, startIndex).replace(/\s+$/, "");
  const after = content.slice(endIndex + end.length).replace(/^\s+/, "");
  return `${before}\n\n${after}`;
}

function replaceBetween(content: string, start: string, end: string, replacement: string): string {
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(
      "The no-observe documentation transform no longer finds the block it rewrites.",
    );
  }
  return content.slice(0, startIndex) + replacement + content.slice(endIndex + end.length);
}
