import { isNonNegativeDecimal, pricingLimits } from "./pricing-constants.ts";
import type { Rational } from "./pricing-schema.ts";

export function normalizeRational(numerator: bigint, denominator = 1n): Rational {
  if (numerator < 0n || denominator <= 0n) throw new Error("Pricing rationals are non-negative");
  if (numerator === 0n) return { numerator: "0", denominator: "1" };
  const divisor = greatestCommonDivisor(numerator, denominator);
  const normalized = {
    numerator: String(numerator / divisor),
    denominator: String(denominator / divisor),
  };
  if (
    normalized.numerator.length > pricingLimits.exactIntegerDigits ||
    normalized.denominator.length > pricingLimits.exactIntegerDigits
  )
    throw new Error("Exact-integer digit limit exceeded");
  return normalized;
}

export function rationalFromDecimal(value: string): Rational {
  if (!isNonNegativeDecimal(value)) throw new Error(`Invalid non-negative decimal: ${value}`);
  const [integer = "0", fraction = ""] = value.split(".");
  return normalizeRational(BigInt(`${integer}${fraction}`), 10n ** BigInt(fraction.length));
}

export function multiplyRationals(left: Rational, right: Rational): Rational {
  return normalizeRational(
    BigInt(left.numerator) * BigInt(right.numerator),
    BigInt(left.denominator) * BigInt(right.denominator),
  );
}

export function addRationals(left: Rational, right: Rational): Rational {
  return normalizeRational(
    BigInt(left.numerator) * BigInt(right.denominator) +
      BigInt(right.numerator) * BigInt(left.denominator),
    BigInt(left.denominator) * BigInt(right.denominator),
  );
}

export function subtractRationalsFloorZero(left: Rational, right: Rational): Rational {
  if (compareRationals(left, right) <= 0) return normalizeRational(0n);
  return normalizeRational(
    BigInt(left.numerator) * BigInt(right.denominator) -
      BigInt(right.numerator) * BigInt(left.denominator),
    BigInt(left.denominator) * BigInt(right.denominator),
  );
}

export function divideRationals(left: Rational, right: Rational): Rational {
  if (right.numerator === "0") throw new Error("Cannot divide by zero");
  return normalizeRational(
    BigInt(left.numerator) * BigInt(right.denominator),
    BigInt(left.denominator) * BigInt(right.numerator),
  );
}

export function compareRationals(left: Rational, right: Rational): -1 | 0 | 1 {
  const difference =
    BigInt(left.numerator) * BigInt(right.denominator) -
    BigInt(right.numerator) * BigInt(left.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function roundUpRational(value: Rational, increment: Rational): Rational {
  if (increment.numerator === "0") throw new Error("Billing increment must be positive");
  const scaledValue = BigInt(value.numerator) * BigInt(increment.denominator);
  const scaledIncrement = BigInt(value.denominator) * BigInt(increment.numerator);
  const incrementCount = (scaledValue + scaledIncrement - 1n) / scaledIncrement;
  return normalizeRational(
    incrementCount * BigInt(increment.numerator),
    BigInt(increment.denominator),
  );
}

export function rationalToFiniteDecimal(value: Rational): string | undefined {
  let denominator = BigInt(value.denominator);
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos++;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives++;
  }
  if (denominator !== 1n) return undefined;

  const places = Math.max(twos, fives);
  const scaled =
    BigInt(value.numerator) * 2n ** BigInt(places - twos) * 5n ** BigInt(places - fives);
  const digits = String(scaled).padStart(places + 1, "0");
  if (places === 0) return digits;
  const decimal = `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return decimal.replace(/\.?0+$/, "");
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}
