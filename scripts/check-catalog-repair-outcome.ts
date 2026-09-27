import { readFile } from "node:fs/promises";
import { assertCatalogRepairOutcome } from "../src/catalog/catalog-repair.ts";

const path = process.env.GH_AW_SAFE_OUTPUTS;
if (!path) throw new Error("Missing catalog repair output path");
assertCatalogRepairOutcome(await readFile(path, "utf8"));
