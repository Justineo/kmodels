import { z } from "zod";

export const modelIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/i);
