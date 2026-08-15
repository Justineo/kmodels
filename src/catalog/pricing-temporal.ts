import { z } from "zod";
import { pricingLimits } from "./pricing-constants.ts";

const dailyTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const dailyTimeWindowSchema = z
  .strictObject({
    from: dailyTime,
    until: dailyTime,
  })
  .refine(({ from, until }) => from < until, {
    message: "A daily time window must end after it starts",
  });

export const dailyTimeScheduleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("daily_time_windows"),
    time_zone: z.literal("UTC"),
    windows: z
      .array(dailyTimeWindowSchema)
      .min(1)
      .max(pricingLimits.dailyTimeWindows)
      .superRefine((windows, context) => {
        for (let index = 1; index < windows.length; index += 1) {
          const previous = windows[index - 1];
          const current = windows[index];
          if (previous !== undefined && current !== undefined && previous.until > current.from)
            context.addIssue({
              code: "custom",
              message: "Daily time windows must be sorted and non-overlapping",
            });
        }
      }),
  }),
  z.strictObject({
    kind: z.literal("daily_time_remainder"),
    time_zone: z.literal("UTC"),
  }),
]);

export type DailyTimeSchedule = z.infer<typeof dailyTimeScheduleSchema>;
