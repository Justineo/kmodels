import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { sha256 } from "../src/catalog/io.ts";
import type { InferencePriceQuery } from "../src/pricing/inference-schema.ts";
import { databricksInferenceFixture } from "./databricks-inference-fixture.ts";
import { replayProviderEvidence } from "./repair-provider-replay.ts";

it("replays reviewed receipts through lookup, rejection with retention, and recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repair-provider-"));
  const capture = join(dir, "capture.json");
  const sourceId = "databricks-models";
  const bundle = await databricksInferenceFixture();
  const save = async (body: string, observed_at: string) =>
    writeFile(
      capture,
      JSON.stringify({
        body,
        observed_at,
        scope: "source",
        source_id: sourceId,
        source_url: bundle.index.url,
        source_hash: sha256(body),
      }),
    );
  const request: InferencePriceQuery = {
    provider_id: "databricks",
    model_id: "databricks-gpt-oss-20b",
    selectors: [
      {
        kind: "categorical",
        dimension: { namespace: "kmodels", value: "served_service_tier" },
        value: {
          namespace: "provider",
          provider_id: "databricks",
          value: "standard",
        },
      },
    ],
  };
  const body = JSON.stringify(bundle);
  try {
    await save(body, "2026-11-19T00:00:00Z");
    const fresh = await replayProviderEvidence({ [sourceId]: capture });
    expect(fresh.attempt.pricing, JSON.stringify(fresh.attempt)).toMatchObject({
      outcome: "accepted",
    });
    expect(fresh.lookup?.(request).status).toBe("matched");
    const snapshot = fresh.published.pricing.data.provider_snapshots[0];
    expect(snapshot?.publication).toBe("fresh");

    await save("{broken", "2026-11-20T00:00:00Z");
    const rejected = await replayProviderEvidence({ [sourceId]: capture }, fresh.published);
    expect(rejected.attempt.outcome).toBe("rejected");
    expect(rejected.published.pricing.data.provider_snapshots[0]).toMatchObject({
      publication: "retained",
      observed_at: snapshot?.observed_at,
    });
    expect(rejected.lookup?.(request).candidates.map(({ offer }) => offer)).toEqual(
      fresh.lookup?.(request).candidates.map(({ offer }) => offer),
    );

    await save(body, "2026-11-21T00:00:00Z");
    const recovered = await replayProviderEvidence({ [sourceId]: capture }, rejected.published);
    expect(recovered.published.pricing.data.provider_snapshots[0]).toMatchObject({
      publication: "fresh",
      observed_at: "2026-11-21T00:00:00.000Z",
    });
    expect(recovered.lookup?.(request).status).toBe("matched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
