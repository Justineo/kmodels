import { z } from "zod";
import { commercialDimensions } from "./commercial-labels.ts";

export {
  commercialDimensions,
  commercialConditionDimension,
  commercialDimensionLabels,
  commercialDefinitions,
  commercialValueLabel,
  type CommercialDimension,
} from "./commercial-labels.ts";

export const commercialDimensionSchema = z.enum(commercialDimensions);
