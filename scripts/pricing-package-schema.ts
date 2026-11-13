import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { priceDataEnvelopeSchema } from "../src/pricing/schema.ts";
import { commercialPriceQuerySchema } from "../src/pricing/commercial.ts";

await writeJsonSchema("schema.json", priceDataEnvelopeSchema);
await writeJsonSchema("query.schema.json", commercialPriceQuerySchema);

async function writeJsonSchema(fileName: string, schema: z.ZodType): Promise<void> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  await writeFile(
    new URL(`../packages/pricing/${fileName}`, import.meta.url),
    `${JSON.stringify(jsonSchema, null, 2)}\n`,
  );
}
