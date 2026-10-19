import { canonicalJson } from "./canonical-json.ts";
import type { OpenAiPricingClaim } from "./openai-pricing-cells.ts";
import type { PricingReconciliationItem } from "./pricing-reconciliation.ts";
import { multiplyDecimal, rawPricingFact, scaleDecimal, wholeTokenCount } from "./pricing.ts";
import type { SourcePriceFact, SourceRawPricingFact } from "./pricing-source.ts";

function decimal(value: string | undefined): string | undefined {
  return value !== undefined && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    ? scaleDecimal(value, 0)
    : undefined;
}

function longRule(statement: string) {
  const match = statement.match(
    /^Prompts with (?:>|more than )(\S+) input tokens are priced at (\S+)x input( and cache rates)? and (\S+)x output for the full request\.$/i,
  );
  if (match === null) return;
  const threshold = wholeTokenCount(match[1] ?? "");
  if (threshold === undefined || threshold === Number.MAX_SAFE_INTEGER) return;
  return {
    threshold,
    cacheWrites: match[3] !== undefined,
    input: decimal(match[2]),
    output: decimal(match[4]),
  };
}

function cacheScope(rate: SourcePriceFact): string {
  const conditions = { ...rate.conditions };
  delete conditions.context_min_tokens;
  delete conditions.context_max_tokens;
  return canonicalJson([rate.currency, rate.unit, conditions]);
}

function covers(write: SourcePriceFact, input: SourcePriceFact): boolean {
  return (
    cacheScope(write) === cacheScope(input) &&
    (write.conditions.context_min_tokens ?? 0) <= (input.conditions.context_min_tokens ?? 0) &&
    (write.conditions.context_max_tokens === undefined ||
      (input.conditions.context_max_tokens !== undefined &&
        input.conditions.context_max_tokens <= write.conditions.context_max_tokens))
  );
}

export function applyOpenAiCardRules(
  claims: readonly OpenAiPricingClaim[],
  notes: readonly string[],
  sourceId: string,
): { rates: SourcePriceFact[]; raw: SourceRawPricingFact[]; items: PricingReconciliationItem[] } {
  let rates = claims.flatMap(({ rate }) =>
    rate === undefined ? [] : [{ ...rate, conditions: { ...rate.conditions } }],
  );
  const explicitWrites = rates.filter((rate) => rate.meter === "cache_write_text");
  const raw = claims.flatMap((claim) => (claim.raw === undefined ? [] : [claim.raw]));
  const items = claims.map(({ item }) => item);
  const longNotes = notes.filter((note) => /^Prompts with\b/i.test(note));
  if (longNotes.length > 0) {
    const rules = longNotes.map(longRule);
    const first = rules[0];
    const scope =
      first !== undefined &&
      rules.every(
        (rule) =>
          rule !== undefined &&
          rule.threshold === first.threshold &&
          rule.cacheWrites === first.cacheWrites,
      )
        ? first
        : undefined;
    const rule =
      scope !== undefined &&
      scope.input !== undefined &&
      scope.output !== undefined &&
      rules.every((rule) => rule?.input === scope.input && rule?.output === scope.output)
        ? scope
        : undefined;
    let scoped = false;
    if (scope !== undefined)
      rates = rates.flatMap((rate) => {
        const input =
          rate.meter === "input_text" ||
          rate.meter === "cache_read_text" ||
          (rate.meter === "cache_write_text" && scope.cacheWrites);
        if (rate.unit !== "million_tokens" || (!input && rate.meter !== "output_text"))
          return [rate];
        scoped = true;
        const short = {
          ...rate,
          conditions: { ...rate.conditions, context_max_tokens: scope.threshold },
        };
        const multiplier = input ? rule?.input : rule?.output;
        if (multiplier === undefined) return [short];
        return [
          short,
          {
            ...rate,
            price: multiplyDecimal(rate.price, multiplier),
            conditions: { ...rate.conditions, context_min_tokens: scope.threshold + 1 },
            derived: true,
            derivation:
              multiplier +
              " × published " +
              rate.meter +
              " rate above " +
              scope.threshold +
              " input tokens",
            raw_price: undefined,
            raw_unit: "published long-context multiplier",
          },
        ];
      });
    for (const note of longNotes) {
      if (rule !== undefined && scoped) {
        items.push({
          disposition: "normalized",
          reason_code: "long_context_multiplier_bound",
          sample: note.slice(0, 256),
        });
      } else {
        raw.push(
          rawPricingFact(
            sourceId,
            "long-context-multiplier",
            "base_price",
            scope === undefined ? "unknown_applicability" : "unknown_amount",
            note,
            scope === undefined ? {} : { context_min_tokens: scope.threshold + 1 },
          ),
        );
        items.push({
          disposition: "unresolved",
          reason_code: "model_card_price_scope_unresolved",
          sample: note.slice(0, 256),
        });
      }
    }
  }
  const cacheNotes = notes.filter((note) => /^Cache writes are billed at\b/i.test(note));
  if (cacheNotes.length > 0) {
    const missing = rates.filter(
      (rate) =>
        rate.meter === "input_text" &&
        rate.unit === "million_tokens" &&
        !explicitWrites.some((write) => covers(write, rate)),
    );
    const multipliers = cacheNotes.map((note) =>
      decimal(
        note.match(/^Cache writes are billed at (\S+)x the uncached input token rate\.$/i)?.[1],
      ),
    );
    const first = multipliers[0];
    const multiplier =
      first !== undefined && multipliers.every((value) => value === first) ? first : undefined;
    if (multiplier !== undefined)
      rates.push(
        ...missing.map((rate) => ({
          ...rate,
          meter: "cache_write_text" as const,
          price: multiplyDecimal(rate.price, multiplier),
          derived: true,
          derivation: multiplier + " × published uncached input rate",
          raw_price: undefined,
          raw_unit: "published cache-write multiplier",
        })),
      );
    for (const note of cacheNotes) {
      const covered = missing.length === 0 && explicitWrites.length > 0;
      if (covered || (missing.length > 0 && multiplier !== undefined)) {
        items.push({
          disposition: covered ? "excluded" : "normalized",
          reason_code: covered
            ? "cache_write_multiplier_not_applied"
            : "cache_write_multiplier_bound",
          sample: note.slice(0, 256),
        });
      } else {
        const scopes = missing.length === 0 ? [{}] : missing.map((rate) => rate.conditions);
        for (const conditions of scopes)
          raw.push(
            rawPricingFact(
              sourceId,
              "cache-write-multiplier",
              "base_price",
              "unknown_amount",
              note,
              conditions,
            ),
          );
        items.push({
          disposition: "unresolved",
          reason_code: "model_card_price_cell_unreadable",
          sample: note.slice(0, 256),
        });
      }
    }
  }
  return { rates, raw, items };
}
