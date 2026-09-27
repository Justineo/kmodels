import { copyFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { calculationEnvelopeSchema, calculationRequestSchema } from "../src/pricing/schema.ts";

await writeJsonSchema("schema.json", calculationEnvelopeSchema);
await writeJsonSchema("request.schema.json", calculationRequestSchema);
await copyFile(
  new URL("../tests/fixtures/calculator/conformance.json", import.meta.url),
  new URL("../packages/pricing/conformance.json", import.meta.url),
);

async function writeJsonSchema(fileName: string, schema: z.ZodType): Promise<void> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  const destination = new URL(`../packages/pricing/${fileName}`, import.meta.url);
  await writeFile(destination, `${JSON.stringify(jsonSchema, null, 2)}\n`);
}
