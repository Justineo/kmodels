import { beforeAll } from "vite-plus/test";
import { generatedData } from "./generated-data-context.ts";

// Load and decode the shared accepted pair outside individual assertion budgets.
beforeAll(async () => {
  await generatedData();
}, 90_000);
