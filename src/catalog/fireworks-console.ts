import { z } from "zod";
import { fireworksFlightRecords } from "./fireworks-flight.ts";
import { modelIdSchema } from "./identity.ts";
import { assertSourceConstraint } from "./source-contract.ts";

export const fireworksPublicId = modelIdSchema.refine((id) =>
  /^accounts\/[a-z0-9._-]+\/(?:models|routers)\/[a-z0-9._-]+$/u.test(id),
);
export function fireworksConsoleUrl(id: string): string {
  const parts = fireworksPublicId.parse(id).split("/");
  assertSourceConstraint("Fireworks console target is not a model", parts[2] === "models", id);
  return `https://app.fireworks.ai/models/${parts[1]}/${parts[3]}`;
}

const modeSchema = z.object({
  name: z.string(),
  usageIdentifier: z.string(),
  serviceTier: z.string(),
  skuInfos: z
    .array(
      z.object({
        sku: z.string(),
        unit: z.string(),
        amount: z.object({
          currencyCode: z.string(),
          units: z.string().regex(/^(?:\$n)?(?:0|[1-9]\d*)$/u),
          nanos: z.number().int().min(0).max(999999999),
        }),
      }),
    )
    .max(32),
});
const widgetSchema = z.tuple([
  z.literal("$"),
  z.string().regex(/^\$L/u),
  z.null(),
  z.object({
    model: z.string().regex(/^\$[a-f0-9]+:/u),
    serverlessModes: z.array(modeSchema).max(32),
  }),
]);

export function fireworksConsoleModes(body: string, id: string) {
  const widgets: z.infer<typeof widgetSchema>[] = [];
  let visited = 0;
  function visit(value: unknown, depth: number): void {
    assertSourceConstraint(
      "Fireworks console graph exceeded its bound",
      ++visited <= 100_000 && depth <= 64,
      visited,
    );
    const widget = widgetSchema.safeParse(value);
    if (widget.success) {
      widgets.push(widget.data);
      return;
    }
    if (Array.isArray(value)) for (const child of value) visit(child, depth + 1);
    else if (value !== null && typeof value === "object")
      for (const child of Object.values(value)) visit(child, depth + 1);
  }
  for (const record of fireworksFlightRecords(body)) visit(record, 0);
  assertSourceConstraint(
    "Fireworks console lost its unique price widget",
    widgets.length === 1,
    id,
  );
  const modes = widgets[0]?.[3].serverlessModes;
  assertSourceConstraint("Fireworks console omitted its modes", modes !== undefined, id);
  const names = new Set<string>();
  const recipes = new Set<string>();
  for (const mode of modes) {
    const target = fireworksPublicId.parse(mode.usageIdentifier || id);
    const recipe = JSON.stringify([target, mode.serviceTier]);
    assertSourceConstraint(
      "Fireworks console mode has a foreign owner or repeated recipe",
      mode.name.startsWith(`${id}/serverlessModes/`) &&
        /^[a-z0-9-]+$/u.test(mode.name.slice(`${id}/serverlessModes/`.length)) &&
        !names.has(mode.name) &&
        !recipes.has(recipe),
      mode.name,
    );
    names.add(mode.name);
    recipes.add(recipe);
  }
  return modes;
}
