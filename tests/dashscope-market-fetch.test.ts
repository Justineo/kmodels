import { afterEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { fetchSource } from "../src/catalog/fetch.ts";
import { dashscopeMarketBundleSchema } from "../src/catalog/dashscope-market.ts";
import { reviewedPublicSource } from "../src/catalog/public-evidence.ts";

const state = vi.hoisted(() => {
  const requests: string[][] = [];
  return { mode: "complete", requests };
});
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const options = z.array(z.string()).parse(args[1]);
    const callback = args.at(-1);
    if (typeof callback !== "function") throw new Error("Missing callback");
    state.requests.push(options);
    const form = options.find((value) => value.startsWith("params="));
    let body = "pricing guide";
    if (form !== undefined) {
      const request = z
        .object({
          Data: z.object({
            input: z.object({ pageNo: z.number(), pageSize: z.number(), serviceSite: z.string() }),
          }),
        })
        .parse(JSON.parse(form.slice(7)));
      const { pageNo, pageSize, serviceSite } = request.Data.input;
      const row = {
        model: `model-${state.mode === "duplicate" ? 1 : pageNo}`,
        scope: "PUBLIC",
        serviceSites: [state.mode === "foreign" ? "foreign" : serviceSite],
      };
      body = JSON.stringify({
        code: "200",
        httpStatusCode: "200",
        successResponse: true,
        data: {
          success: state.mode !== "nested error",
          httpStatus: 200,
          DataV2: {
            ret: ["SUCCESS::接口调用成功"],
            data: {
              codeEnum: "SUCCESS",
              code: "200",
              data: {
                total: state.mode === "total drift" && pageNo > 1 ? 3 : 2,
                pageNo,
                pageSize,
                list: state.mode === "empty" ? [] : [row],
              },
            },
          },
        },
      });
    }
    callback(null, {
      stdout: `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n${body}`,
      stderr: "",
    });
  },
}));
afterEach(() => {
  state.mode = "complete";
  state.requests.length = 0;
});

function source() {
  const { linkedDocuments: _documents, ...source } = reviewedPublicSource("dashscope-pricing");
  return {
    ...source,
    linkedDocuments: { path: /$a/, minDocuments: 0, maxDocuments: 0, concurrency: 1 },
    transport: {
      kind: "dashscope-pricing" as const,
      pageSize: 1,
      maxPages: 3,
      maxModelsPerContext: 3,
      concurrency: 2,
    },
  };
}

it("collects every region and deployment scope anonymously through bounded flat pagination", async () => {
  const result = await fetchSource(source());
  const bundle = dashscopeMarketBundleSchema.parse(JSON.parse(result.body));
  expect(bundle.market).toHaveLength(10);
  expect(bundle.market?.every(({ models }) => models.length === 2)).toBe(true);
  expect(result.dependencies.filter(({ key }) => key.includes(":market:"))).toHaveLength(20);
  for (const request of state.requests) {
    expect(request.join(" ")).not.toMatch(/Authorization|Cookie|Anonymous-Id|TraceId/i);
    const form = request.find((value) => value.startsWith("params="));
    if (form !== undefined)
      expect(JSON.parse(form.slice(7))).toMatchObject({
        Data: { input: { group: false, queryPrice: true, supports: { inference: true } } },
      });
  }
});

it.each(["nested error", "total drift", "duplicate", "foreign", "empty"])(
  "rejects a %s instead of publishing a partial market",
  async (mode) => {
    state.mode = mode;
    await expect(fetchSource(source())).rejects.toThrow();
  },
);

it("enforces reviewed hosts and page/model bounds", async () => {
  const input = source();
  await expect(fetchSource({ ...input, allowedHosts: ["www.alibabacloud.com"] })).rejects.toThrow(
    "allowlist",
  );
  await expect(
    fetchSource({ ...input, transport: { ...input.transport, maxPages: 1 } }),
  ).rejects.toThrow();
  await expect(
    fetchSource({ ...input, transport: { ...input.transport, maxModelsPerContext: 1 } }),
  ).rejects.toThrow();
});
