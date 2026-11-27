import { load } from "cheerio";
import { z } from "zod";
import { assertSourceConstraint, parseSourceJson } from "./source-contract.ts";

// React Flight text and binary records are length-framed and may contain newlines or record headers.
export function fireworksFlightRecords(body: string) {
  const $ = load(body);
  const chunks = $("script")
    .toArray()
    .flatMap((script) => {
      const frame = $(script)
        .text()
        .trim()
        .match(/^self\.__next_f\.push\((\[[13],"(?:[^"\\]|\\.)*"\])\);?$/su)?.[1];
      return frame === undefined
        ? []
        : [
            z
              .tuple([z.literal([1, 3]), z.string()])
              .parse(parseSourceJson(frame, "Fireworks Flight frame")),
          ];
    });
  const parts: Buffer[] = [];
  let text: string[] = [];
  for (const [type, chunk] of chunks) {
    if (type === 1) {
      text.push(chunk);
    } else {
      parts.push(Buffer.from(text.join("")), Buffer.from(chunk, "base64"));
      text = [];
    }
  }
  parts.push(Buffer.from(text.join("")));
  const bytes = Buffer.concat(parts);
  const records: unknown[] = [];
  const errors: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] === 10) {
      offset++;
      continue;
    }
    const header = bytes
      .subarray(offset, offset + 64)
      .toString()
      .match(/^([a-f0-9]*):/u)?.[0];
    assertSourceConstraint("Fireworks Flight lost a record header", header !== undefined, offset);
    offset += header.length;
    if ("TAOobUSsLlGgMmV".includes(String.fromCharCode(bytes[offset] ?? 0))) {
      const length = bytes
        .subarray(offset, offset + 32)
        .toString()
        .match(/^.([a-f0-9]+),/u);
      assertSourceConstraint(
        "Fireworks Flight lost a record length",
        length?.[1] !== undefined,
        offset,
      );
      offset += length[0].length + Number.parseInt(length[1], 16);
      assertSourceConstraint(
        "Fireworks Flight record was truncated",
        offset <= bytes.length,
        offset,
      );
      continue;
    }
    const newline = bytes.indexOf(10, offset);
    const end = newline < 0 ? bytes.length : newline;
    const payload = bytes.subarray(offset, end).toString();
    if (/^[[{]/u.test(payload)) records.push(parseSourceJson(payload, "Fireworks Flight record"));
    else if (payload.startsWith("E{")) errors.push(payload.slice(1));
    offset = end + 1;
  }
  return { records, errors };
}
