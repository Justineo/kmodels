import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseSource } from "../src/catalog/adapters.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { validateInvocationCatalog } from "../src/catalog/invocation-validation.ts";
import { invocationRequestTemplate } from "../src/catalog/invocation-request.ts";
import { retainUnavailableInvocation } from "../src/catalog/invocation-collection.ts";

const manifest = manifests.find(({ provider }) => provider.id === "anthropic");
if (manifest === undefined) throw new Error("Missing Anthropic provider");
const source = manifest.sources.find(({ id }) => id === "anthropic-models");
if (source === undefined) throw new Error("Missing Anthropic catalog");
const provider = { ...manifest.provider, source_ids: manifest.sources.map(({ id }) => id) };
const root = "https://platform.claude.com/docs/en/";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/anthropic/${name}`, import.meta.url), "utf8");
const documents = [
  ["api/messages/create.md", "invocation-messages.md"],
  ["api/overview.md", "invocation-api-overview.md"],
  ["api/versioning.md", "invocation-versioning.md"],
  ["about-claude/models/model-ids-and-versions.md", "invocation-model-ids.md"],
  ["manage-claude/data-residency.md", "invocation-data-residency.md"],
  ["build-with-claude/fast-mode.md", "invocation-fast-mode.md"],
] as const;

async function parse(overrides: Readonly<Record<string, string | null>> = {}) {
  if (source === undefined) throw new Error("Missing source");
  const body = JSON.stringify({
    index: {
      url: source.url,
      body: overrides.overview ?? (await fixture("invocation-overview.md")),
    },
    documents: (
      await Promise.all(
        documents.map(async ([path, name]) => ({
          url: `${root}${path}`,
          body: overrides[name] === null ? null : (overrides[name] ?? (await fixture(name))),
        })),
      )
    ).filter(({ body }) => body !== null),
  });
  const result = parseSource({ provider, source, body, observedAt: "2026-10-30T00:00:00.000Z" });
  if (result.invocation === undefined) throw new Error("Missing invocation graph");
  validateInvocationCatalog(result.invocation, {
    providers: [provider],
    models: result.models,
    sources: [{ id: source.id, provider_id: "anthropic", scope: "global" }],
  });
  return { ...result, invocation: result.invocation };
}

// Controlled catalog rows exercise older IDs no longer listed in the current overview table.
async function withLegacyModels() {
  return `${await fixture("invocation-overview.md")}\n\n| Feature | Claude Opus 5 | Claude Opus 4.6 | Claude Haiku 4.5 |\n| --- | --- | --- | --- |\n| Claude API ID | claude-opus-5 | claude-opus-4-6 | claude-haiku-4-5-20251001 |\n| Claude API alias | claude-opus-5 | claude-opus-4-6 | claude-haiku-4-5 |\n`;
}

describe("Anthropic invocation contracts", () => {
  it("keeps native pinned identity, explicit routing and actual Fast speed separate", async () => {
    const { invocation } = await parse();
    const targets = invocation.invocation_targets.filter(
      ({ address }) => address.kind === "literal" && address.value === "claude-opus-5-5",
    );
    expect(targets).toHaveLength(6);
    expect(targets.every(({ resolution }) => resolution === "pinned")).toBe(true);
    const target = targets.find(
      ({ selectors, cases }) =>
        selectors.some(
          ({ location, value }) =>
            location.key === "/speed" && value.kind === "literal" && value.value === "fast",
        ) &&
        cases[0]?.inference_geo.kind === "exact" &&
        cases[0].inference_geo.value === "us",
    );
    const entry = target?.cases[0];
    const surface = invocation.surfaces[0];
    if (target === undefined || entry === undefined || surface === undefined)
      throw new Error("Missing US Fast target");
    expect(entry.inference_mode).toEqual({ kind: "exact", value: "fast" });
    expect(entry.support.state).toBe("supported");
    expect(target.selectors.some(({ location }) => location.key === "anthropic-beta")).toBe(false);
    const request = invocationRequestTemplate(surface, target, entry, {
      provider_id: "anthropic",
      identifier: "claude-opus-5-5",
      task: "text_generation",
    });
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.headers).toEqual({ "anthropic-version": "2026-10-21" });
    expect(request.body_fields).toEqual(
      expect.arrayContaining([
        { pointer: "/model", value: "claude-opus-5-5" },
        { pointer: "/inference_geo", value: "us" },
        { pointer: "/speed", value: "fast" },
      ]),
    );
    const defaults = targets.filter(
      ({ selectors }) => !selectors.some(({ location }) => location.key === "/inference_geo"),
    );
    expect(defaults.every(({ cases }) => cases[0]?.inference_geo.kind === "unknown")).toBe(true);
  });

  it("keeps research preview headers and the Opus 4.6 standard-speed exception", async () => {
    const { invocation } = await parse({ overview: await withLegacyModels() });
    for (const [id, mode] of [
      ["claude-opus-5", "fast"],
      ["claude-opus-4-6", "standard"],
    ]) {
      const target = invocation.invocation_targets.find(
        ({ address, selectors }) =>
          address.kind === "literal" &&
          address.value === id &&
          selectors.some(({ location }) => location.key === "/speed"),
      );
      expect(target?.selectors).toContainEqual({
        location: { kind: "header", key: "anthropic-beta" },
        value: { kind: "literal", value: "fast-mode-2026-02-01" },
      });
      expect(target?.cases[0]?.inference_mode).toEqual({ kind: "exact", value: mode });
      expect(target?.release_stage).toBe("preview");
    }
  });

  it("uses older aliases as rolling request identifiers and rejects explicit geo on older models", async () => {
    const { invocation } = await parse({ overview: await withLegacyModels() });
    const aliases = invocation.invocation_targets.filter(
      ({ address }) => address.kind === "literal" && address.value === "claude-haiku-4-5",
    );
    expect(aliases).toHaveLength(3);
    expect(
      aliases.every(
        ({ resolution, resolved_model_ref }) =>
          resolution === "rolling" && resolved_model_ref === "anthropic/claude-haiku-4-5-20251001",
      ),
    ).toBe(true);
    expect(aliases.filter(({ cases }) => cases[0]?.support.state === "unsupported")).toHaveLength(
      2,
    );
    expect(
      invocation.invocation_targets.some(
        ({ address }) => address.kind === "literal" && address.value.startsWith("anthropic."),
      ),
    ).toBe(false);
  });

  it.each(["invocation-messages.md", "invocation-api-overview.md", "invocation-versioning.md"])(
    "withholds wire targets when %s is unavailable",
    async (name) => {
      const { invocation } = await parse({ [name]: null });
      expect(invocation.invocation_targets).toEqual([]);
      expect(
        invocation.target_coverage.every(({ reason }) => reason === "source_unavailable"),
      ).toBe(true);
    },
  );

  it("does not let examples, response fields or duplicate request declarations establish the wire", async () => {
    const messages = await fixture("invocation-messages.md");
    for (const body of [
      messages.replace("- `model: Model`", "- `renamed_model: Model`"),
      messages.replace("- `model: Model`", "- `model: Model`\n- `model: string`"),
    ]) {
      const { invocation } = await parse({ "invocation-messages.md": body });
      expect(invocation.invocation_targets).toEqual([]);
    }
  });

  it("withdraws only explicit geo/Fast targets when their contracts drift", async () => {
    const geo = await fixture("invocation-data-residency.md");
    const fast = await fixture("invocation-fast-mode.md");
    const { invocation } = await parse({
      "invocation-data-residency.md": geo.replace("## Inference geo", "## Unreviewed geography"),
      "invocation-fast-mode.md": fast.replace("## Availability", "## Unreviewed availability"),
    });
    expect(invocation.invocation_targets.length).toBeGreaterThan(0);
    expect(invocation.invocation_targets.every(({ selectors }) => selectors.length === 1)).toBe(
      true,
    );
  });

  it("retains unavailable wire evidence only while current identity and routing evidence agree", async () => {
    const prior = await parse();
    for (const changed of [false, true]) {
      const fresh = await parse({
        "invocation-messages.md": null,
        ...(changed
          ? {
              overview: (await fixture("invocation-overview.md")).replaceAll(
                "claude-opus-5-5",
                "claude-opus-5-5-revised",
              ),
            }
          : {}),
      });
      const retained = retainUnavailableInvocation(
        fresh.invocation,
        prior.invocation,
        (fresh.invocationRetentionDocuments ?? []).map((document) => ({
          ...document,
          source_ref: "anthropic-models",
        })),
      );
      expect(retained.invocation_targets.length > 0).toBe(!changed);
      validateInvocationCatalog(retained, {
        providers: [provider],
        models: fresh.models,
        sources: [{ id: "anthropic-models", provider_id: "anthropic", scope: "global" }],
      });
    }
  });

  it("does not form Fast/geography combinations after their joint contract is withdrawn", async () => {
    const fast = (await fixture("invocation-fast-mode.md")).replace(
      "multipliers apply on top of fast mode pricing.",
      "combination has not been established.",
    );
    const { invocation } = await parse({ "invocation-fast-mode.md": fast });
    const targets = invocation.invocation_targets.filter(
      ({ model_ref }) => model_ref === "anthropic/claude-opus-5-5",
    );
    expect(targets).toHaveLength(4);
    expect(
      targets
        .filter(({ selectors }) => selectors.some(({ location }) => location.key === "/speed"))
        .every(({ cases }) => cases[0]?.inference_geo.kind === "unknown"),
    ).toBe(true);
  });

  it("withholds ambiguous auth and geographic declarations instead of selecting the first", async () => {
    const api = await fixture("invocation-api-overview.md");
    const duplicateApi = api.replace(
      "## Authentication",
      "## Authentication\n\n| `content-type` | `application/xml` | Yes |",
    );
    expect(
      (await parse({ "invocation-api-overview.md": duplicateApi })).invocation.invocation_targets,
    ).toEqual([]);
    const geo = await fixture("invocation-data-residency.md");
    const duplicateGeo = geo.replace(
      "## Inference geo",
      "## Inference geo\n\nThe `inference_geo` parameter is supported on Claude 5.0 and later models.",
    );
    const { invocation } = await parse({ "invocation-data-residency.md": duplicateGeo });
    expect(
      invocation.invocation_targets.every(
        ({ cases }) => cases[0]?.inference_geo.kind === "unknown",
      ),
    ).toBe(true);
  });

  it("keeps unknown model generations unknown and scopes only the verified streaming contract", async () => {
    const overview = `${await fixture("invocation-overview.md")}\n\n| Feature | Claude Willow |\n| --- | --- |\n| Claude API ID | claude-willow-latest |\n`;
    const { invocation } = await parse({ overview });
    const targets = invocation.invocation_targets.filter(
      ({ model_ref }) => model_ref === "anthropic/claude-willow-latest",
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]?.cases[0]?.inference_geo).toEqual({ kind: "unknown" });
    expect(invocation.scoped_facts.every(({ field }) => field === "capabilities.streaming")).toBe(
      true,
    );
    expect(invocation.scoped_facts.length).toBeGreaterThan(0);
  });
});
