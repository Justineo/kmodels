import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vite-plus/test";

function assertFixturePath(path: unknown): void {
  const value =
    path instanceof URL ? fileURLToPath(path) : Buffer.isBuffer(path) ? path.toString() : path;
  if (typeof value !== "string") return;
  const dataDirectory = fileURLToPath(new URL("../data/", import.meta.url));
  const offset = relative(dataDirectory, resolve(value));
  if (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
    throw new Error("Unit tests must use fixtures or temporary files, not generated data/");
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: (...args: Parameters<typeof fs.readFile>) => {
      assertFixturePath(args[0]);
      return fs.readFile(...args);
    },
    open: (...args: Parameters<typeof fs.open>) => {
      assertFixturePath(args[0]);
      return fs.open(...args);
    },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    open: (...args: Parameters<typeof fs.open>) => {
      assertFixturePath(args[0]);
      return fs.open(...args);
    },
    readFile: (...args: Parameters<typeof fs.readFile>) => {
      assertFixturePath(args[0]);
      return fs.readFile(...args);
    },
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      assertFixturePath(args[0]);
      return fs.openSync(...args);
    },
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      assertFixturePath(args[0]);
      return fs.readFileSync(...args);
    },
    createReadStream: (...args: Parameters<typeof fs.createReadStream>) => {
      assertFixturePath(args[0]);
      return fs.createReadStream(...args);
    },
  };
});
