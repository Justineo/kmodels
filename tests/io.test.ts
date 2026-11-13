import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { parseIJson, readIJson } from "../src/catalog/canonical-json.ts";
import {
  atomicWrite,
  encodeCanonicalChunks,
  fileHandleMatchesCanonicalChunks,
  writeCanonicalChunksIfChanged,
} from "../src/catalog/io.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function output() {
  const directory = await mkdtemp(join(tmpdir(), "kmodels-io-"));
  directories.push(directory);
  return join(directory, "pricing.json");
}
const chunks = ['{"label":', JSON.stringify("€😀".repeat(30_000)), "}"];
const expected = Buffer.from(chunks.join(""));

it("decodes large UTF-8 input without changing parser semantics", async () => {
  const path = await output();
  const source = Buffer.from(`"${"a".repeat(1_048_573)}😀€"`);
  await writeFile(path, source);
  const file = await open(path, "r");
  try {
    expect(await readIJson(file, source.length)).toEqual(parseIJson(source, source.length));
    expect((await file.readFile()).length).toBe(0);
  } finally {
    await file.close();
  }
});

it.each([
  Buffer.from('\ufeff{"x":"€😀"}'),
  Buffer.from('{"a":1,"\\u0061":2}'),
  Buffer.from("/* comment */ null"),
  Buffer.from("[1,]"),
  Buffer.from("null true"),
  Buffer.from('"\\ud800"'),
  Buffer.from('"\\ufdd0"'),
  Buffer.from("1e400"),
  Buffer.from([0x22, 0xc3, 0x28, 0x22]),
  Buffer.from([0x22, 0xf0, 0x9f]),
  Buffer.alloc(0),
])("preserves the byte parser's acceptance and errors for %j", async (source) => {
  const path = await output();
  await writeFile(path, source);
  const file = await open(path, "r");
  try {
    let value: unknown;
    let failure: unknown;
    try {
      value = parseIJson(source, source.length);
    } catch (error) {
      failure = error;
    }
    if (failure instanceof Error)
      await expect(readIJson(file, source.length)).rejects.toThrow(failure.message);
    else expect(await readIJson(file, source.length)).toEqual(value);
  } finally {
    await file.close();
  }
});

it("enforces the file byte limit before decoding, including multibyte text", async () => {
  const path = await output();
  await writeFile(path, '"€"');
  const file = await open(path, "r");
  try {
    await expect(readIJson(file, 4)).rejects.toThrow("4-byte limit");
    expect(await readIJson(file, 5)).toBe("€");
  } finally {
    await file.close();
  }
});

it("compares an already-read handle from byte zero without closing or moving its cursor", async () => {
  const path = await output();
  await writeFile(path, expected);
  const file = await open(path, "r");
  try {
    expect(await file.readFile()).toEqual(expected);
    expect(await fileHandleMatchesCanonicalChunks(file, chunks)).toBe(true);
    expect(await fileHandleMatchesCanonicalChunks(file, chunks)).toBe(true);
    expect((await file.readFile()).length).toBe(0);
  } finally {
    await file.close();
  }
});

it("compares the opened snapshot even when its path is replaced", async () => {
  const path = await output();
  await writeFile(path, expected);
  const original = await open(path, "r");
  try {
    await original.readFile();
    await rename(path, `${path}.old`);
    const changed = Buffer.from(expected);
    changed[65_535] = 0;
    await writeFile(path, changed);
    expect(await fileHandleMatchesCanonicalChunks(original, chunks)).toBe(true);
    const replacement = await open(path, "r");
    try {
      expect(await fileHandleMatchesCanonicalChunks(replacement, chunks)).toBe(false);
    } finally {
      await replacement.close();
    }
  } finally {
    await original.close();
  }
});

it("writes canonical fragments exactly and preserves an unchanged file", async () => {
  const path = await output();
  await writeCanonicalChunksIfChanged(path, chunks);
  expect(await readFile(path)).toEqual(expected);
  expect(Buffer.concat([...encodeCanonicalChunks(chunks)])).toEqual(expected);
  await utimes(path, 0, 0);
  const before = await stat(path, { bigint: true });
  await writeCanonicalChunksIfChanged(path, chunks);
  const after = await stat(path, { bigint: true });
  expect(after.ino).toBe(before.ino);
  expect(after.mtimeNs).toBe(before.mtimeNs);
});

it.each(["truncated", "trailing", "changed"])(
  "replaces a %s file using exact byte comparison",
  async (kind) => {
    const path = await output();
    const changed = Buffer.from(expected);
    changed[65_535] = 0;
    await writeFile(
      path,
      kind === "truncated"
        ? expected.subarray(0, -1)
        : kind === "trailing"
          ? Buffer.concat([expected, Buffer.from(" ")])
          : changed,
    );
    await writeCanonicalChunksIfChanged(path, chunks);
    expect(await readFile(path)).toEqual(expected);
  },
);

it("handles empty canonical fragment sequences without changing file semantics", async () => {
  const path = await output();
  await writeCanonicalChunksIfChanged(path, []);
  expect((await readFile(path)).length).toBe(0);
  await writeFile(path, "x");
  await writeCanonicalChunksIfChanged(path, [""]);
  expect((await readFile(path)).length).toBe(0);
});

it("keeps the accepted file and removes partial output when a chunk writer fails", async () => {
  const path = await output();
  await writeFile(path, "accepted");
  function* interrupted() {
    yield Buffer.from("partial");
    throw new Error("interrupted chunk source");
  }
  await expect(atomicWrite(path, interrupted())).rejects.toThrow("interrupted chunk source");
  expect(await readFile(path, "utf8")).toBe("accepted");
  expect(await readdir(join(path, ".."))).toEqual(["pricing.json"]);
});
