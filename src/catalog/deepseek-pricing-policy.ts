import { load } from "cheerio";
import { htmlText } from "./html.ts";
import type { ProviderAtomRegistryEntry } from "./pricing-schema.ts";
import { canonicalizeInstant } from "./pricing-time.ts";

export type DeepseekCurrency = "CNY" | "USD";

export function deepseekPrice(value: string, currency: DeepseekCurrency): string {
  const pattern =
    currency === "USD" ? /^\$(0|[1-9]\d*)(?:\.(\d+))?$/ : /^(?:¥|￥)?(0|[1-9]\d*)(?:\.(\d+))?元?$/;
  const match = value.match(pattern);
  if (match?.[1] === undefined) throw new Error(`Invalid DeepSeek price: ${value}`);
  return match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
}

export function deepseekEnglishInstant(
  year: string,
  month: string,
  day: string,
  time: string,
  offset: string,
): string {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const index = months.indexOf(month.toLowerCase());
  if (index < 0) throw new Error("Invalid DeepSeek date month");
  return canonicalizeInstant(
    `${year}-${String(index + 1).padStart(2, "0")}-${day.padStart(2, "0")}T${time}:00${offset}`,
  );
}
export type DeepseekBillingPolicy = "daily" | "weekly" | "holiday" | "weekend_transition";

const weekendEffectiveAt = "2026-08-22T16:00:00.000Z";
const windows = "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC";
export const deepseekBillingDefinitions: Record<DeepseekBillingPolicy, string> = {
  daily: `${windows}. All other hours are off-peak.`,
  weekly: `${windows}, Monday through Friday. All other hours are off-peak.`,
  holiday: `${windows}, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.`,
  weekend_transition: `${windows}. All other hours are off-peak. From August 23, 2026 at 00:00 Beijing Time, weekends are entirely off-peak.`,
};

export interface DeepseekBillingRule {
  policy: DeepseekBillingPolicy;
  fragment: string;
}

export function deepseekBillingVocabulary(rule: DeepseekBillingRule): ProviderAtomRegistryEntry[] {
  return ["peak", "off_peak"].map((key) => billingPeriodAtom(key, rule.policy));
}

function billingPeriodAtom(key: string, policy: DeepseekBillingPolicy): ProviderAtomRegistryEntry {
  const label = key === "peak" ? "Peak" : "Off-peak";
  const defined = {
    kind: "categorical_value" as const,
    key,
    dimension: { namespace: "kmodels" as const, value: "billing_period" as const },
    label,
    definition: `${label} billing period. ${deepseekBillingDefinitions[policy]}`,
  };
  if (policy !== "daily" && policy !== "weekly")
    return {
      ...defined,
      definition: `${defined.definition} The caller supplies the applicable billing period.`,
    };
  const weekendsAreOffPeak = policy === "weekly";
  if (key === "peak")
    return {
      ...defined,
      schedule: weekendsAreOffPeak
        ? {
            kind: "weekly_time_windows",
            time_zone: "UTC",
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
            windows: [
              { from: "01:00", until: "04:00" },
              { from: "06:00", until: "10:00" },
            ],
          }
        : {
            kind: "daily_time_windows",
            time_zone: "UTC",
            windows: [
              { from: "01:00", until: "04:00" },
              { from: "06:00", until: "10:00" },
            ],
          },
    };
  return {
    ...defined,
    schedule: {
      kind: weekendsAreOffPeak ? "weekly_time_remainder" : "daily_time_remainder",
      time_zone: "UTC",
    },
  };
}

export function deepseekBillingRule(
  body: string,
  currency: DeepseekCurrency,
  observedAt: string,
): DeepseekBillingRule {
  const $ = load(body);
  $("article pre, article blockquote").remove();
  const prose = htmlText($("article").text());
  const marker =
    currency === "USD"
      ? /Peak hours are/gi
      : /(?:高峰时段为北京时间|北京时间周一至周五（不含中国法定节假日）)/g;
  if ([...prose.matchAll(marker)].length !== 1)
    throw new Error(`DeepSeek ${currency} peak-hour rule is missing or ambiguous`);
  const fragment =
    $("article p, article li")
      .toArray()
      .map((node) => htmlText($(node).text()))
      .find((text) =>
        /Peak hours are|高峰时段为北京时间|北京时间周一至周五（不含中国法定节假日）/.test(text),
      ) ?? prose;
  const result = (policy: DeepseekBillingPolicy): DeepseekBillingRule => ({
    policy,
    fragment: fragment.slice(0, 4096),
  });
  const holiday =
    currency === "USD"
      ? prose.includes(deepseekBillingDefinitions.holiday)
      : /北京时间周一至周五（不含中国法定节假日）9:00\s*[-–]\s*12:00、14:00\s*[-–]\s*18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。/.test(
          prose,
        );
  if (holiday) return result("holiday");
  const weekly =
    currency === "USD"
      ? /Peak hours are 01:00\s*[-–]\s*04:00 and 06:00\s*[-–]\s*10:00 UTC, Monday through Friday \(all other hours are off-peak\)/i
      : /高峰时段为北京时间\s*周一至周五\s*0?9:00\s*[-–]\s*12:00[、，,和]\s*14:00\s*[-–]\s*18:00（其余为(?:空闲|低谷)时段）/;
  if (weekly.test(prose)) return result("weekly");
  const daily =
    currency === "USD"
      ? /Peak hours are 01:00\s*[-–]\s*04:00 and 06:00\s*[-–]\s*10:00 UTC \(all other hours are off-peak\)/i
      : /高峰时段为北京时间\s*0?9:00\s*[-–]\s*12:00[、，,和]\s*14:00\s*[-–]\s*18:00（其余为(?:空闲|低谷)时段）/;
  if (!daily.test(prose)) throw new Error(`DeepSeek ${currency} peak-hour rule changed`);
  const weekend =
    currency === "USD"
      ? /off-peak rates applying throughout the day on weekends \(Saturdays and Sundays, Beijing Time\)/i
      : /周末（周六、周日）全天不再区分峰谷时段，统一按照低谷时段价格收取调用费用/;
  const effective =
    currency === "USD"
      ? /Effective 00:00 \(Beijing Time\) on Sunday, August 23, 2026/i
      : /北京时间\s*2026\s*年\s*8\s*月\s*23\s*日（周日）\s*00:00\s*起/;
  if (weekend.test(prose) && effective.test(prose))
    return result(observedAt < weekendEffectiveAt ? "weekend_transition" : "weekly");
  if (observedAt >= weekendEffectiveAt || /weekends|周末/.test(prose))
    throw new Error(`DeepSeek ${currency} weekend rule changed`);
  return result("daily");
}
