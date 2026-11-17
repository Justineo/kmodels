import { constants } from "node:fs";
import { open, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Check the opened inode, not just the agent-controlled path before opening it. */
export async function readSharedFile(path: string, root: string, limit: number): Promise<string> {
  const base = resolve(root);
  if ((await realpath(base)) !== base) throw new Error("Shared root must not be a symlink");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const actual = await realpath(process.platform === "linux" ? `/proc/self/fd/${file.fd}` : path);
    const within = relative(base, actual);
    if (!within || within.startsWith("..") || isAbsolute(within))
      throw new Error("Shared file escaped its directory");
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new Error("Shared file must be a bounded regular file");
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw new Error("Shared file exceeded its byte limit");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.next`, JSON.stringify(value));
  await rename(`${path}.next`, path);
}
