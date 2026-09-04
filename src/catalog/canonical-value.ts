const utf8 = new TextEncoder();
const canonicalKeys = new WeakMap<object, string>();

export function canonicalJson(value: unknown): string {
  assertIJsonValue(value);
  return serialize(value);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return utf8.encode(canonicalJson(value));
}

// Use only inside typed graphs that are validated as I-JSON before publication.
export function canonicalJsonFromValidated(value: unknown): string {
  return serialize(value);
}

// Canonical catalog graphs are immutable after boundary validation.
export function canonicalJsonKey(value: object): string {
  const current = canonicalKeys.get(value);
  if (current !== undefined) return current;
  const created = canonicalJsonFromValidated(value);
  canonicalKeys.set(value, created);
  return created;
}

export function compareUtf8(left: string, right: string): number {
  const characterLength = Math.min(left.length, right.length);
  for (let index = 0; index < characterLength; index += 1) {
    const leftCharacter = left.charCodeAt(index);
    const rightCharacter = right.charCodeAt(index);
    if (leftCharacter === rightCharacter) continue;
    if (leftCharacter < 0x80 || rightCharacter < 0x80) return leftCharacter - rightCharacter;
    break;
  }
  if (left === right) return 0;
  const leftBytes = utf8.encode(left);
  const rightBytes = utf8.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

export function compareUtf8Sequences(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareUtf8(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

export function compareCanonicalValues(left: unknown, right: unknown): number {
  return left === right ? 0 : compareUtf8(canonicalValueKey(left), canonicalValueKey(right));
}

export function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return left === right || canonicalValueKey(left) === canonicalValueKey(right);
}

export function uniqueCanonicalValues<T>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [canonicalJson(value), value])).values()].sort(
    compareCanonicalValues,
  );
}

function canonicalValueKey(value: unknown): string {
  return value !== null && typeof value === "object" ? canonicalJsonKey(value) : serialize(value);
}

export function assertIJsonValue(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "string") {
      assertIJsonString(current);
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error("JSON number is not finite");
      continue;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (typeof current !== "object") throw new Error("Value is not valid JSON");
    const prototype = Object.getPrototypeOf(current);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(current).length > 0
    )
      throw new Error("Value is not valid JSON");
    for (const [key, item] of Object.entries(current)) {
      assertIJsonString(key);
      pending.push(item);
    }
  }
}

function assertIJsonString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    let codePoint = first;
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!Number.isFinite(second) || second < 0xdc00 || second > 0xdfff)
        throw new Error("JSON string has a lone surrogate");
      codePoint = (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000;
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      throw new Error("JSON string has a lone surrogate");
    }
    if (
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) === 0xfffe ||
      (codePoint & 0xffff) === 0xffff
    )
      throw new Error("JSON string has a Unicode noncharacter");
  }
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`)
    .join(",")}}`;
}
