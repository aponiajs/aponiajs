import { describe, expect, test } from "bun:test";
import Ajv2020, { type AnySchema } from "ajv/dist/2020.js";
import { updateRoadmapVersion } from "./sync-version-references.ts";

type RoadmapStatus = "completed" | "in_progress" | "planned";

interface RoadmapMilestone {
  readonly id: string;
  readonly progressPercent: number;
  readonly itemIds: readonly string[];
}

interface RoadmapItem {
  readonly id: string;
  readonly milestoneId: string;
  readonly status: RoadmapStatus;
  readonly progressPercent: number;
  readonly dependencies: readonly string[];
}

interface RoadmapData {
  readonly project: {
    readonly currentVersion: string;
  };
  readonly summary: {
    readonly total: number;
    readonly completed: number;
    readonly inProgress: number;
    readonly planned: number;
    readonly completionPercent: number;
  };
  readonly milestones: readonly RoadmapMilestone[];
  readonly items: readonly RoadmapItem[];
}

const statuses = ["completed", "in_progress", "planned"] as const;

describe("roadmap data", () => {
  test("synchronizes the current project version without changing roadmap data", () => {
    const roadmap =
      '{\n  "project": {\n    "currentVersion": "0.3.17",\n    "name": "AponiaJS"\n  },\n  "tags": ["compact", "array"]\n}\n';

    expect(updateRoadmapVersion(roadmap, "0.3.18")).toBe(
      '{\n  "project": {\n    "currentVersion": "0.3.18",\n    "name": "AponiaJS"\n  },\n  "tags": ["compact", "array"]\n}\n',
    );
  });

  test("matches its JSON Schema and relational invariants", async () => {
    const [schema, rawRoadmap, workspaceManifest] = await Promise.all([
      Bun.file("roadmap/roadmap.schema.json").json() as Promise<AnySchema>,
      Bun.file("roadmap/roadmap.json").json() as Promise<unknown>,
      Bun.file("package.json").json() as Promise<{ readonly version: string }>,
    ]);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile<RoadmapData>(schema);
    const isValid = validate(rawRoadmap);

    expect(isValid, JSON.stringify(validate.errors, null, 2)).toBe(true);
    if (!isValid) {
      throw new Error("Roadmap schema validation failed.");
    }
    const roadmap = rawRoadmap as RoadmapData;

    expect(roadmap.project.currentVersion).toBe(workspaceManifest.version);

    const itemIds = roadmap.items.map((item) => item.id);
    const milestoneIds = roadmap.milestones.map((milestone) => milestone.id);
    expect(new Set(itemIds).size).toBe(itemIds.length);
    expect(new Set(milestoneIds).size).toBe(milestoneIds.length);

    const knownItems = new Set(itemIds);
    const knownMilestones = new Set(milestoneIds);
    for (const item of roadmap.items) {
      expect(knownMilestones.has(item.milestoneId)).toBe(true);
      for (const dependency of item.dependencies) {
        expect(knownItems.has(dependency)).toBe(true);
      }
      if (item.status === "completed") {
        expect(item.progressPercent).toBe(100);
      } else if (item.status === "planned") {
        expect(item.progressPercent).toBe(0);
      } else {
        expect(item.progressPercent).toBeGreaterThan(0);
        expect(item.progressPercent).toBeLessThan(100);
      }
    }

    for (const milestone of roadmap.milestones) {
      const milestoneItems = roadmap.items
        .filter((item) => item.milestoneId === milestone.id)
        .map((item) => item.id);
      expect([...milestone.itemIds].sort(compareText)).toEqual(milestoneItems.sort(compareText));
      const expectedProgress =
        roadmap.items
          .filter((item) => item.milestoneId === milestone.id)
          .reduce((total, item) => total + item.progressPercent, 0) / milestoneItems.length;
      expect(milestone.progressPercent).toBeCloseTo(expectedProgress, 2);
    }

    const counts = Object.fromEntries(
      statuses.map((status) => [
        status,
        roadmap.items.filter((item) => item.status === status).length,
      ]),
    ) as Record<RoadmapStatus, number>;
    const expectedCompletion =
      roadmap.items.reduce((total, item) => total + item.progressPercent, 0) / roadmap.items.length;

    expect(roadmap.summary).toEqual({
      total: roadmap.items.length,
      completed: counts.completed,
      inProgress: counts.in_progress,
      planned: counts.planned,
      completionPercent: Number(expectedCompletion.toFixed(2)),
    });
  });
});

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}
