import { z } from "zod";

const armCostSchema = z.object({
  name: z.string().optional(),
  meterId: z.string().optional(),
  unit: z.string().optional(),
});

const armSkuWireSchema = z.object({
  name: z.string().min(1),
  usageName: z.string().optional(),
  cost: z.array(armCostSchema).optional(),
  costs: z.array(armCostSchema).optional(),
});

/**
 * ARM documents `cost`, while the live 2025-06-01 Models API currently returns
 * `costs`. Normalize both spellings at the source boundary and reject a response
 * that presents two different commercial inventories.
 */
export const azureArmSkuSchema = armSkuWireSchema
  .superRefine(({ cost, costs }, context) => {
    if (cost !== undefined && costs !== undefined && JSON.stringify(cost) !== JSON.stringify(costs))
      context.addIssue({
        code: "custom",
        message: "ARM SKU cost and costs fields disagree",
      });
  })
  .transform(({ cost, costs, ...sku }) => ({ ...sku, costs: costs ?? cost ?? [] }));

export type AzureArmCost = z.infer<typeof armCostSchema>;
export type AzureArmSku = z.infer<typeof azureArmSkuSchema>;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function armCostMeterId(cost: AzureArmCost): string | undefined {
  return nonEmpty(cost.meterId);
}
