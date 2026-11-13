import { z } from "zod";
import { priceDataEnvelopeSchema } from "../src/pricing/schema.ts";
export const lookupFixtureSchema = z.strictObject({
  datasets: z.record(z.string(), priceDataEnvelopeSchema),
});
export type LookupFixtures = z.infer<typeof lookupFixtureSchema>;
