import { beforeEach, vi } from "vite-plus/test";

const { offline } = vi.hoisted(() => ({
  offline: () => {
    throw new Error("Tests must mock network and subprocess transports");
  },
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  exec: offline,
  execSync: offline,
  execFile: offline,
  execFileSync: offline,
  spawn: offline,
  spawnSync: offline,
  fork: offline,
}));
vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  get: offline,
  request: offline,
}));
vi.mock("node:https", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:https")>()),
  get: offline,
  request: offline,
}));

vi.stubGlobal("fetch", offline);
beforeEach(() => vi.stubGlobal("fetch", offline));
