import { describe, expect, it } from "vite-plus/test";
import {
  sagemakerOpenSpecs,
  projectSagemakerSpec,
  parseSagemakerSdk,
} from "../src/catalog/sagemaker-sdk.ts";
import { manifests } from "../src/catalog/manifests.ts";
import { websiteModelDetail } from "../src/catalog/website-data.ts";
import { emptyPricingCatalog } from "../src/catalog/pricing-schema.ts";
import { websiteModelDetailSchema } from "../src/catalog/website-schema.ts";
import { providerModelSchema } from "../src/catalog/schema.ts";
import { renderComponent } from "./render-component.ts";
import ModelMetadata from "../src/components/ModelMetadata.vue";
import { fetchSagemakerSdk } from "../src/catalog/sagemaker-fetch.ts";
import { sha256 } from "../src/catalog/io.ts";
import { parseSagemakerCatalog, sagemakerPricingSpecs } from "../src/catalog/sagemaker.ts";
import { readFile } from "node:fs/promises";
import { applyGroups, retainSourceFacts } from "../src/catalog/collector.ts";
import { baseModel } from "../src/catalog/model.ts";

const manifest = manifests.find((m) => m.provider.id === "amazon-sagemaker");
const source = manifest?.sources.find((s) => s.id === "sagemaker-sdk");
if (!manifest || !source) throw new Error("Missing SageMaker SDK manifest");
const provider = { ...manifest.provider, source_ids: manifest.sources.map((s) => s.id) };
const header = (id: string, version = "1.0", overrides: object = {}) => ({
  model_id: id,
  version,
  spec_key: `community_models/${id}/specs_v${version}.json`,
  deprecated: false,
  search_keywords: ["Foundation Models", "Text-to-Video"],
  ...overrides,
});
const admitted = [
  { id: "existing", name: "Existing", task: "Forecasting", fineTuning: false, proprietary: false },
];
const spec = {
  model_id: "new-video",
  version: "1.0",
  provider: "Publisher",
  license: "Apache-2.0",
  model_size: "1B-10B",
  context_window: "<4K",
  languages: ["English"],
  huggingface_id: "Publisher/Model",
  model_access: "Gated",
  ml_framework: "PyTorch",
  input_modalities: ["Text"],
  output_modalities: ["Video", "Embeddings"],
  fine_tuning_supported: false,
  supported_inference_instance_types: ["ml.large"],
  default_inference_instance_type: "ml.large",
  hosting_model_package_arns: { region: "PRIVATE_RESOURCE" },
  inference_environment_variables: [
    { name: "MAX_MODEL_LEN", default: "4096" },
    { name: "HF_TOKEN", default: "PRIVATE_CREDENTIAL" },
  ],
  inference_configs: { interact: { component_names: ["small"] } },
  inference_config_components: {
    small: {
      supported_inference_instance_types: ["ml.small"],
      default_inference_instance_type: "ml.small",
      hosting_ecr_specs: {
        framework: "vllm",
        framework_version: "1.0",
        image_uri: "PRIVATE_IMAGE",
      },
      inference_environment_variables: [{ name: "MAX_MODEL_LEN", default: 2048 }],
      hosting_instance_type_variants: {
        variants: {
          "ml.small": {
            properties: {
              environment_variables: { MAX_MODEL_LEN: "1024", HF_TOKEN: "PRIVATE_TOKEN" },
            },
          },
        },
      },
    },
  },
};

describe("SageMaker SDK catalog", () => {
  it("requires positive foundation or text-generation evidence for new proprietary IDs", () => {
    const body = JSON.stringify([
      {
        model_id: "new-generator",
        version: "1.0",
        spec_key: "proprietary-models/new-generator/proprietary_specs_1.0.json",
        search_keywords: ["Text", "Generation"],
      },
      {
        model_id: "classic",
        version: "1.0",
        spec_key: "proprietary-models/classic/proprietary_specs_1.0.json",
        search_keywords: ["Tabular", "Classification"],
      },
    ]);
    expect(sagemakerPricingSpecs(body, [], true).map((header) => header.model_id)).toEqual([
      "new-generator",
    ]);
    expect(sagemakerPricingSpecs(body, [])).toEqual([]);
  });

  it("corrects only reviewed exact task conflicts and keeps original source labels", async () => {
    const html = await readFile(
      new URL("./fixtures/sagemaker-models.html", import.meta.url),
      "utf8",
    );
    for (const [id, label, expected] of [
      ["bria-ai-2-3-commercial", "ReRank", "image_generation"],
      ["cohere-rerank-v4-0-pro", "Text Embedding", "reranking"],
      ["unreviewed-rerank-name", "Text Embedding", "embeddings"],
    ]) {
      if (!id || !label) throw new Error("Missing fixture identity");
      const body = html
        .replace("fixture-embedding", id)
        .replace("<td>Text Embedding</td>", `<td>${label}</td>`);
      const model = parseSagemakerCatalog({
        provider,
        source,
        body,
        observedAt: "2026-09-21T00:00:00Z",
      }).find((model) => model.model_id === id);
      expect(model).toMatchObject({
        tasks: [expected],
        raw_type: label,
        task_evidence: [{ raw_value: label }],
      });
      const sdk = projectSagemakerSpec(
        JSON.stringify({ ...spec, model_id: id }),
        header(id, "1.0", { search_keywords: [label] }),
      );
      const [sdkModel] = parseSagemakerSdk({
        provider,
        source,
        body: JSON.stringify([sdk]),
        observedAt: "2026-09-21T00:00:00Z",
      });
      expect(sdkModel?.tasks).toEqual([expected]);
    }
  });

  it("retains optional metadata without replacing fresher published model facts", () => {
    const current = baseModel({
      providerId: provider.id,
      id: "existing",
      name: "Existing",
      sourceId: "catalog",
      observedAt: "2026-09-21T00:00:00Z",
    });
    current.model_card = { publisher: "Current" };
    const previous = {
      ...current,
      source_refs: [source.id],
      model_card: { publisher: "Old", license: "MIT" },
      deployment: { package_version: "1.0", region: "west", profiles: [] },
    };
    const {
      models: [retained],
    } = retainSourceFacts([current], [previous], source);
    expect(retained?.model_card).toEqual({ publisher: "Current", license: "MIT" });
    expect(retained?.deployment).toEqual(previous.deployment);
    const [merged] = applyGroups(
      [current],
      [{ source, models: [{ ...current, model_card: { license: "Apache-2.0" } }] }],
      false,
    );
    expect(merged?.model_card).toEqual({ publisher: "Current", license: "Apache-2.0" });
  });
  it("admits explicit foundation models from current specs, while retaining static catalog identities", () => {
    const selected = sagemakerOpenSpecs(
      JSON.stringify([
        header("existing", "1.0", { search_keywords: ["Forecasting"] }),
        header("new-video", "1.9"),
        header("new-video", "1.10"),
        header("classic", "1.0", { search_keywords: ["Open Weights", "Classification"] }),
        header("deprecated", "1.0"),
        header("deprecated", "2.0", { deprecated: true }),
      ]),
      admitted,
    );
    expect(selected.map(({ model_id, version }) => [model_id, version])).toEqual([
      ["existing", "1.0"],
      ["new-video", "1.10"],
    ]);
    expect(() => sagemakerOpenSpecs(JSON.stringify([header("new-video")]), admitted)).toThrow(
      "omitted an admitted model",
    );
    expect(() =>
      sagemakerOpenSpecs(
        JSON.stringify([header("existing", "1.0", { spec_key: "../other.json" })]),
        admitted,
      ),
    ).toThrow("path changed identity");
  });

  it("preserves ranges and conditional configuration scopes without publishing runtime internals", () => {
    const projected = projectSagemakerSpec(JSON.stringify(spec), header("new-video"));
    expect(JSON.stringify(projected)).not.toContain("PRIVATE_");
    expect(projected.model_card).toMatchObject({
      publisher: "Publisher",
      size: "1B-10B",
      context_window: "<4K",
      license: "Apache-2.0",
    });
    expect(projected.output).toEqual(["video", "embedding"]);
    expect(projected.deployment.profiles).toMatchObject([
      {
        name: "default",
        instance_types: ["ml.large"],
        context_settings: [{ name: "MAX_MODEL_LEN", value: "4096" }],
      },
      {
        name: "small",
        configurations: ["interact"],
        instance_types: ["ml.small"],
        context_settings: [
          { name: "MAX_MODEL_LEN", value: 2048 },
          { name: "MAX_MODEL_LEN", value: "1024", instance_type: "ml.small" },
        ],
      },
    ]);
    expect(() =>
      projectSagemakerSpec(JSON.stringify({ ...spec, version: "2.0" }), header("new-video")),
    ).toThrow("identity changed");
    expect(() =>
      projectSagemakerSpec(
        JSON.stringify({ ...spec, inference_config_components: {} }),
        header("new-video"),
      ),
    ).toThrow("omitted a component");
  });

  it("uses opaque resource versions for the exact SDK join without publishing them as package labels", () => {
    const version = "arn:aws:sagemaker:us-west-2:123456789012:model-package/fixture";
    const projected = projectSagemakerSpec(
      JSON.stringify({ ...spec, version }),
      header("new-video", version),
    );
    expect(projected.deployment.package_version).toBeUndefined();
    expect(projected.deployment.profiles[0]?.instance_types).toEqual(["ml.large"]);
    expect(JSON.stringify(projected)).not.toMatch(/arn:aws|123456789012/);
  });

  it("round-trips detail-only metadata and renders package limits distinctly from model limits", async () => {
    const body = JSON.stringify([projectSagemakerSpec(JSON.stringify(spec), header("new-video"))]);
    const [parsed] = parseSagemakerSdk({
      provider,
      source,
      body,
      observedAt: "2026-09-21T00:00:00Z",
    });
    const model = providerModelSchema.parse(parsed);
    expect(model.tasks).toEqual(["video_generation"]);
    expect(model.version).toBeUndefined();
    expect(model.limits).toEqual({});
    expect(model.availability).toBeUndefined();
    const detail = websiteModelDetailSchema.parse(websiteModelDetail(emptyPricingCatalog(), model));
    expect(detail.deployment).toEqual(model.deployment);
    expect(detail.model_card).toEqual(model.model_card);
    const html = await renderComponent(ModelMetadata, { detail });
    expect(html).toContain("Apache-2.0");
    expect(html).toContain("&lt;4K");
    expect(html).toContain("JumpStart package");
    expect(html).toContain("ml.large");
    expect(html).toContain("not a universal model limit");
    expect(html).not.toContain("PRIVATE_");
  });

  it("fetches exact spec dependencies and publishes only their reviewed projection", async () => {
    const catalog =
      '<dd tab-id="open-weight-models-(1)"><table><thead><tr><th>Model ID</th><th>Model Name</th><th>Task</th><th>Fine-tunable</th></tr></thead><tbody><tr><td>new-video</td><td>Video</td><td>Text-to-Video</td><td>No</td></tr></tbody></table></dd><dd tab-id="proprietary-models-(0)"><table><thead><tr><th>Model ID</th><th>Model Name</th><th>Task</th><th>Fine-tunable</th></tr></thead><tbody></tbody></table></dd>';
    const requests: string[] = [];
    const result = await fetchSagemakerSdk(source, async (request) => {
      requests.push(request.url);
      const body =
        request.url === source.url
          ? catalog
          : request.url.endsWith("/models_manifest.json")
            ? JSON.stringify([header("new-video")])
            : request.url.endsWith("/proprietary-sdk-manifest.json")
              ? "[]"
              : JSON.stringify(spec);
      return { body, contentHash: sha256(body), etag: undefined, lastModified: undefined };
    });
    expect(requests).toHaveLength(4);
    expect(result.dependencies).toHaveLength(4);
    expect(result.body).not.toContain("PRIVATE_");
    expect(JSON.parse(result.body)).toMatchObject([
      { id: "new-video", model_card: { publisher: "Publisher" } },
    ]);
  });
});
