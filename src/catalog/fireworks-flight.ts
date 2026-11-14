import { load } from "cheerio";
import { z } from "zod";
import { assertSourceConstraint, parseSourceJson } from "./source-contract.ts";

// React Flight text records carry a UTF-8 byte length and may contain fake record headers.
export function fireworksFlightRecords(body: string): unknown[] {
  const $ = load(body);
  const chunks = $("script")
    .toArray()
    .flatMap((script) => {
      const frame = $(script)
        .text()
        .trim()
        .match(/^self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\);?$/su)?.[1];
      return frame === undefined
        ? []
        : [
            z
              .tuple([z.literal(1), z.string()])
              .parse(parseSourceJson(frame, "Fireworks Flight frame"))[1],
          ];
    });
  const bytes = Buffer.from(chunks.join(""));
  const records: unknown[] = [];
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
    if (bytes[offset] === 84) {
      const length = bytes
        .subarray(offset, offset + 32)
        .toString()
        .match(/^T([a-f0-9]+),/u);
      assertSourceConstraint(
        "Fireworks Flight lost a text length",
        length?.[1] !== undefined,
        offset,
      );
      offset += length[0].length + Number.parseInt(length[1], 16);
      assertSourceConstraint("Fireworks Flight text was truncated", offset <= bytes.length, offset);
      continue;
    }
    const newline = bytes.indexOf(10, offset);
    const end = newline < 0 ? bytes.length : newline;
    const payload = bytes.subarray(offset, end).toString();
    if (/^[[{]/u.test(payload)) records.push(parseSourceJson(payload, "Fireworks Flight record"));
    offset = end + 1;
  }
  return records;
}
