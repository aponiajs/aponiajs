# Roadmap Data

`roadmap.json` is the machine-readable source for an AponiaJS roadmap or
tracking website. `roadmap.schema.json` is its JSON Schema 2020-12 contract.

The data is normalized:

- `milestones` define ordered product phases and reference work through
  `itemIds`;
- `items` contain status, progress, dependencies, packages, evidence,
  acceptance criteria, and next actions;
- `statusDefinitions` provide labels, ordering, and colors for a board UI;
- `summary` contains precomputed counts and overall progress.

Status meanings:

- `completed`: implemented and supported by repository or GitHub evidence;
- `in_progress`: an active workstream with remaining actions;
- `planned`: not implemented and retained in the approved architecture plans.

Validate the data with:

```bash
bun run roadmap:validate
```

The repository test verifies the JSON Schema and cross-record relationships.
Update `generatedAt`, `project.sourceCommit`, item evidence, milestone progress,
and summary values whenever roadmap status changes.
