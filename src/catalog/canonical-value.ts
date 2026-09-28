const utf8 = new TextEncoder();
const canonicalKeys = new WeakMap<object, string>();

export function canonicalJson(value: unknown): string {
  assertIJsonValue(value);
  return canonicalJsonFromValidated(value);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return utf8.encode(canonicalJson(value));
}

// Use only inside typed graphs that are validated as I-JSON before publication.
export function canonicalJsonFromValidated(value: unknown): string {
  return canonicalJsonChunksFromValidated(value).join("");
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
  return [...new Map(values.map((value) => [canonicalJson(value), value]))]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([, value]) => value);
}

function canonicalValueKey(value: unknown): string {
  return value !== null && typeof value === "object"
    ? canonicalJsonKey(value)
    : canonicalJsonFromValidated(value);
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
      for (const item of current) pending.push(item);
      continue;
    }
    if (typeof current !== "object") throw new Error("Value is not valid JSON");
    const prototype: unknown = Object.getPrototypeOf(current);
    const isPlainObject = prototype === null || Object.getPrototypeOf(prototype) === null;
    if (!isPlainObject || Object.getOwnPropertySymbols(current).length > 0)
      throw new Error("Value is not valid JSON");
    for (const key of Object.keys(current)) {
      assertIJsonString(key);
      pending.push(Reflect.get(current, key));
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

// Callers publishing large graphs can hash these chunks and frame the envelope
// without allocating both a complete data string and a complete envelope string.
export function canonicalJsonChunksFromValidated(value: unknown): string[] {
  // Joining each subtree retains large intermediate strings at every nesting level.
  // Flatten bounded fragments once, leaving final assembly to the caller.
  const chunks: string[] = [];
  const fragments: string[] = [];
  let length = 0;
  function append(source: string): void {
    fragments.push(source);
    length += source.length;
    if (length >= 65_536) {
      chunks.push(fragments.join(""));
      fragments.length = 0;
      length = 0;
    }
  }
  function write(current: unknown): void {
    if (
      current === null ||
      typeof current === "boolean" ||
      typeof current === "number" ||
      typeof current === "string"
    ) {
      append(JSON.stringify(current));
    } else if (Array.isArray(current)) {
      append("[");
      let separator = "";
      for (const item of current) {
        append(separator);
        write(item);
        separator = ",";
      }
      append("]");
    } else if (typeof current === "object") {
      append("{");
      let separator = "";
      for (const key of Object.keys(current).sort()) {
        append(`${separator}${JSON.stringify(key)}:`);
        write(Reflect.get(current, key));
        separator = ",";
      }
      append("}");
    } else {
      throw new Error("Value is not valid JSON");
    }
  }
  write(value);
  if (fragments.length > 0) chunks.push(fragments.join(""));
  return chunks;
}
