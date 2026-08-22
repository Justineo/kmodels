import { z } from "zod";
import { pricingLimits } from "./pricing-constants.ts";

const dailyTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const recurringWeekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const recurringWeekdaySchema = z.enum(recurringWeekdays);

export const dailyTimeWindowSchema = z
  .strictObject({
    from: dailyTime,
    until: dailyTime,
  })
  .refine(({ from, until }) => from < until, {
    message: "A daily time window must end after it starts",
  });

const dailyTimeWindowsSchema = z
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
  });

const recurringWeekdaysSchema = z
  .array(recurringWeekdaySchema)
  .min(1)
  .max(recurringWeekdays.length)
  .superRefine((days, context) => {
    for (let index = 1; index < days.length; index += 1) {
      const previous = days[index - 1];
      const current = days[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        recurringWeekdays.indexOf(previous) >= recurringWeekdays.indexOf(current)
      )
        context.addIssue({
          code: "custom",
          message: "Recurring weekdays must be sorted and unique",
        });
    }
  });

export const recurringTimeScheduleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("daily_time_windows"),
    time_zone: z.literal("UTC"),
    windows: dailyTimeWindowsSchema,
  }),
  z.strictObject({
    kind: z.literal("daily_time_remainder"),
    time_zone: z.literal("UTC"),
  }),
  z.strictObject({
    kind: z.literal("weekly_time_windows"),
    time_zone: z.literal("UTC"),
    days: recurringWeekdaysSchema,
    windows: dailyTimeWindowsSchema,
  }),
  z.strictObject({
    kind: z.literal("weekly_time_remainder"),
    time_zone: z.literal("UTC"),
  }),
]);

export type RecurringTimeSchedule = z.infer<typeof recurringTimeScheduleSchema>;
