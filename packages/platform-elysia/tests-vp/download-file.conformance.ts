import { Controller, Get, Module, Set, type RouteResponseSettings } from "@aponiajs/common";
import type { ElysiaFile } from "elysia";
import { AponiaFactory, downloadFile, type DownloadFileOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

// The settled contract, pinned: the helper writes the settings it is handed and
// returns the file the platform streams. A signature that grew a parameter or
// started returning a Response fails `bun run check` here.
const settled = downloadFile satisfies (
  settings: RouteResponseSettings,
  path: string,
  filename: string,
  options?: DownloadFileOptions,
) => ElysiaFile;

@Controller("conformance")
class ConformanceController {
  @Get()
  read(@Set() set: RouteResponseSettings) {
    // The lane never reads the body, so the path only has to be one that exists
    // wherever the two lanes run from: the repository root.
    return downloadFile(set, "package.json", "conformance.txt");
  }
}

@Module({ controllers: [ConformanceController] })
class ConformanceModule {}

test("names a download through the compiled invoker", async () => {
  const application = await AponiaFactory.create(ConformanceModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/conformance"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"conformance.txt\"; filename*=UTF-8''conformance.txt",
    );
  } finally {
    await application.close();
  }
});

void settled;
