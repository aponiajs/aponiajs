import { test } from "bun:test";
import {
  conformanceCreate,
  platformConformanceCases,
} from "../../platform-core/test/support/platform-contract.ts";
import { AponiaFactory } from "./index.ts";

const create = conformanceCreate((root, options) => AponiaFactory.create(root, options));

for (const conformanceCase of platformConformanceCases) {
  test(conformanceCase.name, async () => {
    await conformanceCase.run(create);
  });
}
