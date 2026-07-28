import { describe, expect, test } from "bun:test";

const roadmap = await Bun.file("ROADMAP.md").text();
const milestoneSection = roadmap.split("## Architecture blueprint")[0] ?? roadmap;

describe("consolidated roadmap", () => {
  test("keeps the progress summary synchronized with milestone item statuses", () => {
    const statuses = [
      ...milestoneSection.matchAll(
        /^- \*\*Status:\*\* (Completed|In progress|Planned) \((\d+)%\)$/gm,
      ),
    ].map((match) => ({
      name: match[1],
      progress: Number(match[2]),
    }));
    const counts = {
      completed: statuses.filter((status) => status.name === "Completed").length,
      inProgress: statuses.filter((status) => status.name === "In progress").length,
      planned: statuses.filter((status) => status.name === "Planned").length,
    };
    const overallProgress =
      statuses.reduce((total, status) => total + status.progress, 0) / statuses.length;

    expect(roadmap).toContain(
      `**Progress:** ${counts.completed} completed, ${counts.inProgress} in progress, ${counts.planned} planned of ${statuses.length} items (${overallProgress.toFixed(2)}% overall).`,
    );
  });

  test("does not refer to the roadmap sources removed by consolidation", () => {
    expect(roadmap).not.toContain("`plans/");
    expect(roadmap).not.toContain("`roadmap/");
  });

  test("keeps file evidence rooted in paths that exist", async () => {
    const evidenceBlocks = [...milestoneSection.matchAll(/^Evidence:\n\n((?:- .+\n?)+)/gm)];

    for (const block of evidenceBlocks) {
      for (const match of block[1]?.matchAll(/`([^`]+)`/g) ?? []) {
        const reference = match[1];
        if (!reference || reference.startsWith("http") || reference.startsWith("#")) {
          continue;
        }

        const path = reference.split("#")[0];
        expect(await Bun.file(path).exists(), `Missing roadmap evidence: ${reference}`).toBe(true);
      }
    }
  });
});
