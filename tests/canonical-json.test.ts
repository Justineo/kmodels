import { describe, expect, it } from "vite-plus/test";
import {
  assertCanonicalJson,
  canonicalJson,
  canonicalJsonHash,
  parseIJson,
} from "../src/catalog/canonical-json.ts";

const encoder = new TextEncoder();

function encoded(value: string): Uint8Array {
  return encoder.encode(value);
}

describe("RFC 8785 JSON", () => {
  it("canonicalizes object members, strings, and binary64 numbers", () => {
    expect(
      canonicalJson({
        z: -0,
        a: [Number("333333333.33333329"), "\u20ac", "\u000f", "😀"],
      }),
    ).toBe('{"a":[333333333.3333333,"€","\\u000f","😀"],"z":0}');
    expect(canonicalJsonHash({ b: 1, a: 2 })).toBe(canonicalJsonHash({ a: 2, b: 1 }));
  });

  it("rejects duplicate decoded member names", () => {
    expect(() => parseIJson(encoded('{"a":1,"\\u0061":2}'), 100)).toThrow("Duplicate JSON member");
  });

  it("rejects invalid I-JSON strings and non-finite numbers", () => {
    expect(() => parseIJson(encoded('"\\ud800"'), 100)).toThrow("lone surrogate");
    expect(() => parseIJson(encoded('"\\ufdd0"'), 100)).toThrow("noncharacter");
    expect(() => parseIJson(encoded("1e400"), 100)).toThrow("not finite");
    expect(parseIJson(encoded('"\\ud83d\\ude00"'), 100)).toBe("😀");
  });

  it("enforces the encoded-input limit before parsing", () => {
    expect(() => parseIJson(encoded("  null"), 5)).toThrow("5-byte limit");
    expect(parseIJson(encoded("null"), 4)).toBeNull();
  });

  it("accepts only exact canonical asset bytes", () => {
    expect(assertCanonicalJson(encoded('{"a":1,"b":2}'), 100)).toEqual({ a: 1, b: 2 });
    expect(() => assertCanonicalJson(encoded('{ "a": 1, "b": 2 }'), 100)).toThrow(
      "not in RFC 8785 canonical form",
    );
    expect(() => assertCanonicalJson(encoded('{"b":2,"a":1}'), 100)).toThrow(
      "not in RFC 8785 canonical form",
    );
  });
});
