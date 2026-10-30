import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { calculationEnvelopeSchema, calculationRequestSchema } from "../src/pricing/schema.ts";
import {
  calculationV2EnvelopeSchema,
  calculationV2RequestSchema,
} from "../src/pricing/v2/schema.ts";
import { conformanceSchema } from "../tests/pricing-conformance.ts";
import { v2Conformance } from "../tests/pricing-v2-conformance.ts";

await mkdir(new URL("../packages/pricing/v1/", import.meta.url), { recursive: true });
await writeJsonSchema("schema.json", calculationV2EnvelopeSchema);
await writeJsonSchema("request.schema.json", calculationV2RequestSchema);
await writeJsonSchema("v1/schema.json", calculationEnvelopeSchema);
await writeJsonSchema("v1/request.schema.json", calculationRequestSchema);
await copyFile(
  new URL("../tests/fixtures/calculator/conformance.json", import.meta.url),
  new URL("../packages/pricing/v1/conformance.json", import.meta.url),
);
const legacy = conformanceSchema.parse(
  JSON.parse(
    await readFile(
      new URL("../tests/fixtures/calculator/conformance.json", import.meta.url),
      "utf8",
    ),
  ),
);
await writeFile(
  new URL("../packages/pricing/conformance.json", import.meta.url),
  `${JSON.stringify(v2Conformance(legacy), null, 2)}\n`,
);

async function writeJsonSchema(fileName: string, schema: z.ZodType): Promise<void> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  const destination = new URL(`../packages/pricing/${fileName}`, import.meta.url);
  await writeFile(destination, `${JSON.stringify(jsonSchema, null, 2)}\n`);
}
