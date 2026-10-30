import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { linkedBundleSchema } from "../src/catalog/bundle.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { openAiDirectWires } from "../src/catalog/openai-invocation-wire.ts";
import {
  openAiWebSocketContracts,
  openAiWebSocketWire,
} from "../src/catalog/openai-invocation-websocket.ts";
import { invocationRequestTemplate } from "../src/catalog/invocation-request.ts";
import { openAiRegionalInvocations } from "../src/catalog/openai-invocation-regions.ts";
import {
  openAiInvocationApiUrl,
  openAiInvocationRegionsUrl,
} from "../src/catalog/openai-invocation.ts";
import { validateInvocationCatalog } from "../src/catalog/invocation-validation.ts";
import { retainUnavailableInvocation } from "../src/catalog/invocation-collection.ts";

const manifest = manifests.find(({ provider }) => provider.id === "openai");
if (manifest === undefined) throw new Error("Missing OpenAI provider");
const source = (() => {
  const value = manifest.sources.find(({ id }) => id === "openai-models");
  if (value === undefined) throw new Error("Missing OpenAI source");
  return value;
})();
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/openai/${name}`, import.meta.url), "utf8");
const observedAt = "2026-10-30T00:00:00.000Z";

async function parse(
  options: {
    api?: string | null;
    regions?: string | null;
    catalog?: string;
    documents?: Array<{ url: string; body: string }>;
  } = {},
) {
  const bundle = linkedBundleSchema.parse(
    JSON.parse(options.catalog ?? (await fixture("catalog.json"))),
  );
  const api = options.api === undefined ? await fixture("invocation-embedding.yaml") : options.api;
  const regions =
    options.regions === undefined ? await fixture("invocation-regions.md") : options.regions;
  const result = parseSource({
    provider,
    source,
    observedAt,
    body: JSON.stringify({
      ...bundle,
      documents: [
        ...bundle.documents,
        ...(options.documents ?? []),
        ...(api === null ? [] : [{ url: openAiInvocationApiUrl, body: api }]),
        ...(regions === null ? [] : [{ url: openAiInvocationRegionsUrl, body: regions }]),
      ],
    }),
  });
  if (result.invocation === undefined) throw new Error("Missing invocation graph");
  validateInvocationCatalog(result.invocation, {
    providers: [provider],
    models: result.models,
    sources: [{ id: source.id, provider_id: provider.id, scope: "global" }],
  });
  return { ...result, invocation: result.invocation };
}

describe("OpenAI invocation contracts", () => {
  it("projects a native Realtime model handshake independently of the HTTP API companion", async () => {
    const catalog = linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json")));
    catalog.index.body +=
      "\n- [GPT-Realtime-2.1](/api/docs/models/gpt-realtime-2.1.md): Reasoning model with tool use";
    catalog.documents.push({
      url: "https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md",
      body: await fixture("invocation-gpt-realtime-2.1.md"),
    });
    const documents = await Promise.all(
      openAiWebSocketContracts.map(async ({ url }, index) => ({
        url,
        body: await fixture(
          index === 0 ? "invocation-realtime.md" : "invocation-realtime-translation.md",
        ),
      })),
    );
    const { invocation, models } = await parse({
      api: null,
      regions: null,
      catalog: JSON.stringify(catalog),
      documents,
    });
    const model = models.find(({ model_id }) => model_id === "gpt-realtime-2.1");
    if (model === undefined) throw new Error("Missing native realtime model");
    const surface = invocation.surfaces.find(
      ({ path_template }) => path_template === "/v1/realtime",
    );
    const target = invocation.invocation_targets.find(
      ({ surface_ref, model_ref }) => surface_ref === surface?.id && model_ref === model.uid,
    );
    const entry = target?.cases[0];
    if (surface === undefined || target === undefined || entry === undefined)
      throw new Error("Missing native realtime target");
    expect(target.resolution).toBe("pinned");
    expect(entry).toMatchObject({
      task: "speech_to_speech",
      inference_mode: { kind: "exact", value: "realtime" },
      support: { state: "supported" },
    });
    expect(
      invocationRequestTemplate(surface, target, entry, {
        provider_id: "openai",
        identifier: model.model_id,
        task: "speech_to_speech",
      }),
    ).toMatchObject({
      transport: "websocket",
      method: "GET",
      url: "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1&intent=realtime",
      body_fields: [],
      authentication: "required",
    });
    const translation = invocation.surfaces.find(
      ({ path_template }) => path_template === "/v1/realtime/translations",
    );
    expect(
      invocation.invocation_targets.find(
        ({ surface_ref, model_ref }) => surface_ref === translation?.id && model_ref === model.uid,
      )?.cases[0]?.support.state,
    ).toBe("unsupported");
    expect(
      invocation.surfaces.some(
        ({ path_template }) =>
          path_template.includes("client_secrets") ||
          path_template.includes("transcription_sessions"),
      ),
    ).toBe(false);
  });

  it.each([
    ["origin", "wss://api.openai.com", "wss://other.example"],
    [
      "authentication",
      "Use Bearer Auth (header Authorization).",
      "Use another authentication scheme.",
    ],
    ["model field", "- `model` (query, string, optional)", "- `model` (body, string, optional)"],
    ["required selector", "### Events", "- `workspace` (query, string, required)\n\n### Events"],
    ["duplicate contract", "## Connect", "## Connect\n\n## Connect"],
  ])("withholds a drifting Realtime %s contract", async (_name, before, after) => {
    const contract = openAiWebSocketContracts[0];
    const body = await fixture("invocation-realtime.md");
    expect(openAiWebSocketWire(contract.url, body)).toBeDefined();
    expect(openAiWebSocketWire(contract.url, body.replace(before, after))).toBeUndefined();
  });

  it("keeps native multipart and JSON media contracts separate", async () => {
    const api = await fixture("invocation-media.yaml");
    const wires = openAiDirectWires(api);
    expect(wires.map(({ path, media }) => [path, media])).toEqual([
      ["/v1/audio/transcriptions", "multipart/form-data"],
      ["/v1/audio/translations", "multipart/form-data"],
      ["/v1/images/edits", "application/json"],
      ["/v1/images/edits", "multipart/form-data"],
      ["/v1/videos", "application/json"],
      ["/v1/videos", "multipart/form-data"],
    ]);
    const changed = openAiDirectWires(
      api.replace(
        '"#/components/schemas/CreateImageEditRequest"',
        '"#/components/schemas/UnknownRequest"',
      ),
    );
    expect(
      changed.filter(({ path }) => path === "/v1/images/edits").map(({ media }) => media),
    ).toEqual(["application/json"]);
    expect(changed).toHaveLength(5);
    expect(
      openAiDirectWires(
        api.replace(
          "      parameters: []",
          "      parameters:\n        - name: api-version\n          in: query",
        ),
      ),
    ).toHaveLength(4);
    const parsed = await parse({ api });
    const edits = parsed.invocation.surfaces.filter(
      ({ path_template }) => path_template === "/v1/images/edits",
    );
    expect(edits).toHaveLength(2);
    expect(edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          request_media_type: "application/json",
          identifier_location: { kind: "body", pointer: "/model" },
        }),
        expect.objectContaining({
          request_media_type: "multipart/form-data",
          identifier_location: { kind: "form", parameter: "model" },
        }),
      ]),
    );
  });

  it("admits an explicit default snapshot independently and preserves the rolling resolution", async () => {
    const catalog = linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json")));
    catalog.index.body += "\n- [GPT-4.1](/api/docs/models/gpt-4.1.md): Deprecated";
    catalog.documents.push({
      url: "https://developers.openai.com/api/docs/models/gpt-4.1.md",
      body: await fixture("invocation-gpt-4.1.md"),
    });
    const { models, invocation } = await parse({ catalog: JSON.stringify(catalog) });
    const series = models.find(({ model_id }) => model_id === "gpt-4.1");
    const snapshot = models.find(({ model_id }) => model_id === "gpt-4.1-2025-04-14");
    expect(snapshot).toMatchObject({ status: "deprecated", pricing_state: "unknown", aliases: [] });
    expect(snapshot?.version).toBeUndefined();
    expect(snapshot?.price_facts).toEqual([]);
    expect(
      invocation.invocation_targets.find(({ model_ref }) => model_ref === series?.uid),
    ).toMatchObject({
      resolution: "rolling",
      resolved_model_ref: snapshot?.uid,
    });
    expect(
      invocation.invocation_targets.find(({ model_ref }) => model_ref === snapshot?.uid),
    ).toMatchObject({
      resolution: "pinned",
      address: { kind: "literal", value: "gpt-4.1-2025-04-14" },
    });
    expect(
      invocation.identifier_relations
        .filter(({ value }) => value === snapshot?.model_id)
        .every(({ model_ref }) => model_ref === snapshot?.uid),
    ).toBe(true);
  });

  it("does not promote default-snapshot-shaped names without the snapshot guarantee", async () => {
    const { models } = await parse();
    expect(models.some(({ model_id }) => model_id === "gpt-5.4-2026-03-05")).toBe(false);
  });

  it("preserves an independently indexed snapshot's own facts and its parent's pinning evidence", async () => {
    const catalog = linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json")));
    const parent = await fixture("invocation-gpt-4.1.md");
    catalog.index.body +=
      "\n- [GPT-4.1](/api/docs/models/gpt-4.1.md): Deprecated\n- [GPT-4.1 snapshot](/api/docs/models/gpt-4.1-2025-04-14.md): Deprecated";
    catalog.documents.push(
      { url: "https://developers.openai.com/api/docs/models/gpt-4.1.md", body: parent },
      // Synthetic independently indexed card; its rich facts must not come from the series card.
      {
        url: "https://developers.openai.com/api/docs/models/gpt-4.1-2025-04-14.md",
        body:
          parent
            .replace("Model ID: `gpt-4.1`", "Model ID: `gpt-4.1-2025-04-14`")
            .replace("1,047,576 context window", "123,456 context window")
            .split("## Snapshots")[0] ?? "",
      },
    );
    const { models, invocation } = await parse({ catalog: JSON.stringify(catalog) });
    const model = models.find(({ model_id }) => model_id === "gpt-4.1-2025-04-14");
    expect(model?.limits.context_tokens).toBe(123456);
    const target = invocation.invocation_targets.find(({ model_ref }) => model_ref === model?.uid);
    expect(target?.resolution).toBe("pinned");
    expect(
      invocation.invocation_evidence
        .filter(({ id }) => target?.evidence_refs.includes(id))
        .map(({ document_url }) => document_url),
    ).toContain("https://developers.openai.com/api/docs/models/gpt-4.1.md");
  });

  it("recognizes the owned embedding request model rather than a response model", async () => {
    const api = await fixture("invocation-embedding.yaml");
    expect(openAiDirectWires(api)).toEqual([
      {
        path: "/v1/embeddings",
        name: "Embeddings",
        task: "embeddings",
        requestSchema: "CreateEmbeddingRequest",
        media: "application/json",
      },
    ]);
    expect(
      openAiDirectWires(
        api.replace(
          '"#/components/schemas/CreateEmbeddingRequest"',
          '"#/components/schemas/CreateEmbeddingResponse"',
        ),
      ),
    ).toEqual([]);
    expect(openAiDirectWires(api.replace("        model:\n", "        renamed_model:\n"))).toEqual(
      [],
    );
  });

  it.each([
    [
      "ambiguous deprecation",
      "    post:\n",
      "    post:\n      deprecated: true\n      deprecated: false\n",
    ],
    ["unreadable deprecation", "    post:\n", "    post:\n      deprecated: maybe\n"],
    ["global origin", "https://api.openai.com/v1", "https://other.example/v1"],
    ["authentication", "scheme: bearer", "scheme: basic"],
    [
      "path override",
      "  /embeddings:\n",
      "  /embeddings:\n    servers:\n      - url: https://other.example\n",
    ],
    ["operation override", "    post:\n", "    post:\n      security: []\n"],
    ["duplicate override", "    post:\n", "    post:\n      servers: []\n      servers: []\n"],
    ["request media", "          application/json:\n", "          multipart/form-data:\n"],
  ])("withholds a changed %s contract", async (_label, before, after) => {
    expect(
      openAiDirectWires((await fixture("invocation-embedding.yaml")).replace(before, after)),
    ).toEqual([]);
  });

  it("keeps an operation's deprecation on its targets without retiring the model", async () => {
    const api = (await fixture("invocation-embedding.yaml")).replace(
      "    post:\n",
      "    post:\n      deprecated: true\n",
    );
    const catalog = (await fixture("catalog.json")).replace(
      "Deprecated embedding model",
      "Embedding model",
    );
    const result = await parse({ api, catalog });
    const model = result.models.find(({ model_id }) => model_id === "text-embedding-3-large");
    expect(model?.status).toBe("active");
    const targets = result.invocation.invocation_targets.filter(
      ({ model_ref }) => model_ref === model?.uid,
    );
    expect(targets).toHaveLength(3);
    expect(targets.every(({ lifecycle }) => lifecycle === "deprecated")).toBe(true);
  });

  it("keeps regional model and operation tuples intact", async () => {
    const claims = openAiRegionalInvocations(await fixture("invocation-regions.md"));
    expect(claims.filter(({ region }) => region === "United Arab Emirates")).toEqual([
      {
        modelId: "text-embedding-3-large",
        path: "/v1/embeddings",
        region: "United Arab Emirates",
        origin: "https://ae.api.openai.com",
      },
    ]);
    expect(
      claims
        .filter(({ region }) => region === "United States")
        .map(({ modelId }) => modelId)
        .sort(),
    ).toEqual(["text-embedding-3-large", "text-embedding-3-small", "text-embedding-ada-002"]);
    expect(claims.some(({ path }) => path.startsWith("/v1/audio/"))).toBe(false);
  });

  it("does not infer processing eligibility from storage or an unreviewed domain", async () => {
    const body = await fixture("invocation-regions.md");
    expect(
      openAiRegionalInvocations(
        body.replace("`ae.api.openai.com`", "`other.api.openai.com`"),
      ).every(({ region }) => region !== "United Arab Emirates"),
    ).toBe(true);
    const duplicate = body.split("\n").find((line) => line.startsWith("| United States"));
    if (duplicate === undefined) throw new Error("Missing fixture region");
    expect(
      openAiRegionalInvocations(body.replace(duplicate, `${duplicate}\n${duplicate}`)).every(
        ({ region }) => region !== "United States",
      ),
    ).toBe(true);
  });

  it("withholds a row whose regional exception no longer has the reviewed meaning", async () => {
    const body = (await fixture("invocation-regions.md")).replace(
      "United Arab Emirates:",
      "United States:",
    );
    expect(openAiRegionalInvocations(body)).toEqual([]);
  });

  it("publishes exact origins and explicit negative cases without guessing snapshot support", async () => {
    const { models, invocation } = await parse();
    const embedding = models.find(({ model_id }) => model_id === "text-embedding-3-large");
    const targets = invocation.invocation_targets.filter(
      ({ model_ref }) => model_ref === embedding?.uid,
    );
    expect(targets).toHaveLength(3);
    expect(
      targets.flatMap(({ cases }) => cases).map(({ request_region }) => request_region),
    ).toEqual([
      { kind: "not_applicable" },
      { kind: "exact", value: "United States" },
      { kind: "exact", value: "United Arab Emirates" },
    ]);
    expect(
      invocation.invocation_targets.find(({ cases }) => cases[0]?.support.state === "unsupported")
        ?.address,
    ).toEqual({ kind: "literal", value: "gpt-5.4" });
    expect(
      invocation.identifier_relations.find(({ value }) => value === "gpt-5.4-2026-03-05")?.role,
    ).toBe("unclassified");
    expect(
      invocation.surfaces.every(
        ({ identifier_location }) =>
          identifier_location.kind === "body" && identifier_location.pointer === "/model",
      ),
    ).toBe(true);
    expect(targets[0]?.cases[0]?.inference_geo).toEqual({ kind: "unknown" });
  });

  it("retains opposing card and regional evidence instead of replacing a negative claim", async () => {
    const catalog = linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json")));
    const card = catalog.documents.find(({ url }) => url.includes("text-embedding-3-large"));
    if (card === undefined) throw new Error("Missing embedding card");
    card.body = card.body.replace(
      "| `v1/embeddings` | Supported |",
      "| `v1/embeddings` | Not supported |",
    );
    const { invocation } = await parse({ catalog: JSON.stringify(catalog) });
    const conflicts = invocation.invocation_targets
      .flatMap(({ cases }) => cases)
      .filter(({ support }) => support.state === "conflicting");
    expect(conflicts).toHaveLength(2);
    expect(
      conflicts.every(
        ({ support }) =>
          support.state === "conflicting" &&
          support.claims.map(({ state }) => state).join(",") === "unsupported,supported",
      ),
    ).toBe(true);
  });

  it("retains verified targets only for unavailable companions, not a changed wire contract", async () => {
    const prior = await parse();
    const missing = await parse({ api: null });
    const drift = await parse({
      api: (await fixture("invocation-embedding.yaml")).replace("scheme: bearer", "scheme: basic"),
    });
    expect(missing.invocation.invocation_targets).toEqual([]);
    expect(
      new Map(
        retainUnavailableInvocation(
          missing.invocation,
          prior.invocation,
          (missing.invocationRetentionDocuments ?? []).map((document) => ({
            ...document,
            source_ref: source.id,
          })),
        ).invocation_targets.map((target) => [target.id, target]),
      ),
    ).toEqual(new Map(prior.invocation.invocation_targets.map((target) => [target.id, target])));
    expect(
      retainUnavailableInvocation(drift.invocation, prior.invocation).invocation_targets,
    ).toEqual([]);
  });

  it.each(["support", "lifecycle", "regions"])(
    "does not retain an old target after its %s evidence changes during API failure",
    async (change) => {
      const prior = await parse();
      const catalog = linkedBundleSchema.parse(JSON.parse(await fixture("catalog.json")));
      const card = catalog.documents.find(({ url }) => url.includes("text-embedding-3-large"));
      if (card === undefined) throw new Error("Missing embedding card");
      if (change === "support")
        card.body = card.body.replace(
          "| `v1/embeddings` | Supported |",
          "| `v1/embeddings` | Not supported |",
        );
      if (change === "lifecycle")
        catalog.index.body = catalog.index.body.replace(
          "Deprecated embedding model.",
          "Embedding model.",
        );
      const fresh = await parse({
        api: null,
        catalog: JSON.stringify(catalog),
        ...(change === "regions"
          ? {
              regions: (await fixture("invocation-regions.md")).replace(
                "`ae.api.openai.com`",
                "`changed.api.openai.com`",
              ),
            }
          : {}),
      });
      const retained = retainUnavailableInvocation(
        fresh.invocation,
        prior.invocation,
        (fresh.invocationRetentionDocuments ?? []).map((document) => ({
          ...document,
          source_ref: source.id,
        })),
      );
      const targets = retained.invocation_targets.filter(
        ({ model_ref }) => model_ref === "openai/text-embedding-3-large",
      );
      expect(targets).toHaveLength(change === "regions" ? 1 : 0);
      if (change === "regions")
        expect(targets[0]?.cases[0]?.request_region).toEqual({ kind: "not_applicable" });
      validateInvocationCatalog(retained, {
        providers: [provider],
        models: fresh.models,
        sources: [{ id: source.id, provider_id: provider.id, scope: "global" }],
      });
    },
  );

  it("keeps default targets when the regional companion is absent without widening coverage", async () => {
    const prior = await parse();
    const fresh = await parse({ regions: null });
    const retained = retainUnavailableInvocation(fresh.invocation, prior.invocation);
    expect(retained.invocation_targets).toHaveLength(2);
    expect(
      retained.invocation_targets.every(({ cases }) =>
        cases.every(({ request_region }) => request_region.kind === "not_applicable"),
      ),
    ).toBe(true);
    expect(retained.target_coverage.every(({ state }) => state === "partial")).toBe(true);
  });

  it("retains the index evidence that establishes target lifecycle", async () => {
    const { invocation } = await parse();
    const evidence = invocation.invocation_evidence.find(({ locator }) => locator === "#models");
    expect(evidence).toBeDefined();
    expect(
      invocation.invocation_targets.every(({ evidence_refs }) =>
        evidence_refs.includes(evidence?.id ?? ""),
      ),
    ).toBe(true);
  });
});
