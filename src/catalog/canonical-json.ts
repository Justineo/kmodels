import { parse, printParseErrorCode, visit, type ParseError } from "jsonc-parser";
import { assertIJsonValue, canonicalJsonBytes } from "./canonical-value.ts";
import { sha256 } from "./io.ts";

export { canonicalJson, canonicalJsonBytes } from "./canonical-value.ts";

export function parseIJson(input: Uint8Array, maxBytes: number): unknown {
  if (input.byteLength > maxBytes) throw new Error(`JSON input exceeds the ${maxBytes}-byte limit`);

  const text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  rejectDuplicateMembers(text);

  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  });
  const error = errors[0];
  if (error !== undefined)
    throw new Error(`Invalid JSON at offset ${error.offset}: ${printParseErrorCode(error.error)}`);

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

function rejectDuplicateMembers(text: string): void {
  const members: Array<Set<string>> = [];
  let duplicate: string | undefined;
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
    },
    { allowTrailingComma: false, disallowComments: true },
  );
  if (duplicate !== undefined) throw new Error(`Duplicate JSON member: ${duplicate}`);
}
