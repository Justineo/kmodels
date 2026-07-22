import type { PriceRate } from "./schema.ts";

export function scaleDecimal(value: string, places: number): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
  const [whole = "", fraction = ""] = value.split(".");
  const digits = `${whole}${fraction}`;
  let point = whole.length + places;
  const padded =
    point <= 0
      ? `${"0".repeat(1 - point)}${digits}`
      : point >= digits.length
        ? `${digits}${"0".repeat(point - digits.length)}`
        : digits;
  if (point <= 0) point = 1;
  const integer = padded.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const decimals = padded.slice(point).replace(/0+$/, "");
  return decimals ? `${integer}.${decimals}` : integer;
}

export function multiplyDecimal(left: string, right: string): string {
  const parts = (value: string): [bigint, number] => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
    const [whole = "", fraction = ""] = value.split(".");
    return [BigInt(`${whole}${fraction}`), fraction.length];
  };
  const [leftInteger, leftScale] = parts(left);
  const [rightInteger, rightScale] = parts(right);
  const scale = leftScale + rightScale;
  const digits = (leftInteger * rightInteger).toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const whole = digits.slice(0, -scale).replace(/^0+(?=\d)/, "") || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

export function publishedRate(
  meter: PriceRate["meter"],
  price: string,
  unit: PriceRate["unit"],
  sourceId: string,
  rawUnit: string,
  conditions: PriceRate["conditions"] = {},
): PriceRate {
  return {
    meter,
    price,
    currency: "USD",
    unit,
    conditions,
    source_ref: sourceId,
    derived: false,
    raw_price: price,
    raw_unit: rawUnit,
  };
}
