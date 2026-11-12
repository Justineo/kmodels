import { z } from "zod";

export const executionModeSchema = z.enum(["request", "batch", "realtime"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;
