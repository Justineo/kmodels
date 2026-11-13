import type { FileHandle } from "node:fs/promises";
import { printParseErrorCode, visit, type ParseError } from "jsonc-parser";
import { assertIJsonValue, canonicalJsonBytes } from "./canonical-value.ts";
import { sha256 } from "./io.ts";

export { canonicalJson, canonicalJsonBytes } from "./canonical-value.ts";

export function parseIJson(input: Uint8Array, maxBytes: number): unknown {
  return parseIJsonText(decodeIJsonText(input, maxBytes));
}

function decodeIJsonText(input: Uint8Array, maxBytes: number): string {
  if (input.byteLength > maxBytes) throw new Error(`JSON input exceeds the ${maxBytes}-byte limit`);
  return new TextDecoder("utf-8", { fatal: true }).decode(input);
}

// The caller owns a newly opened handle. Resume with only decoded text, so the
// complete byte buffer is no longer retained while parsing and validating the graph.
export async function readIJson(file: FileHandle, maxBytes: number): Promise<unknown> {
  if ((await file.stat()).size > maxBytes)
    throw new Error(`JSON input exceeds the ${maxBytes}-byte limit`);
  const text = await file.readFile().then((input) => decodeIJsonText(input, maxBytes));
  return parseIJsonText(text);
}

function parseIJsonText(text: string): unknown {
  validateJsonText(text);
  // The visitor checks syntax and duplicate decoded keys without constructing a
  // graph. Let the native parser build the one graph consumed by validation.
  const value: unknown = JSON.parse(text);

  assertIJsonValue(value);
  return value;
}

export function canonicalJsonHash(value: unknown): string {
  return sha256(canonicalJsonBytes(value));
}

export function assertCanonicalJson(input: Uint8Array, maxBytes: number): unknown {
  const value = parseIJson(input, maxBytes);
  const canonical = canonicalJsonBytes(value);
  if (!input.every((byte, index) => canonical[index] === byte) || input.length !== canonical.length)
    throw new Error("JSON input is not in RFC 8785 canonical form");
  return value;
}

function validateJsonText(text: string): void {
  const members: Array<Set<string>> = [];
  let duplicate: string | undefined;
  let firstError: ParseError | undefined;
  visit(
    text,
    {
      onObjectBegin() {
        members.push(new Set());
      },
      onObjectProperty(property) {
        const object = members.at(-1);
        if (object?.has(property)) duplicate ??= property;
        object?.add(property);
      },
      onObjectEnd() {
        members.pop();
      },
      onError(error, offset, length) {
        firstError ??= { error, offset, length };
      },
    },
    { allowEmptyContent: false, allowTrailingComma: false, disallowComments: true },
  );
  if (duplicate !== undefined) throw new Error(`Duplicate JSON member: ${duplicate}`);
  if (firstError !== undefined)
    throw new Error(
      `Invalid JSON at offset ${firstError.offset}: ${printParseErrorCode(firstError.error)}`,
    );
}
