import "./style.css";
import {
  catalogEnvelopeSchema,
  type PriceRate,
  type ProviderModel,
  type SourceRecord,
} from "./catalog/schema.ts";

const app = document.querySelector("#app");
if (!(app instanceof HTMLDivElement)) throw new Error("Missing app root");

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="/" aria-label="Kmodels home">Kmodels</a>
    <span class="dataset-size"><span id="model-count">—</span> models</span>
    <div class="sync-state" id="sync-state"><span class="status-dot"></span><span>Loading catalog</span></div>
    <span class="catalog-version" id="catalog-version">—</span>
    <a class="json-link" href="/v1/catalog/index.json">JSON</a>
  </header>
  <main class="workspace" aria-label="Model catalog">
    <div class="controls">
      <label class="visually-hidden" for="search">Search</label>
      <input id="search" type="search" placeholder="Search models" autocomplete="off" />
      <label class="visually-hidden" for="provider-filter">Provider</label>
      <select id="provider-filter"><option value="">All providers</option></select>
      <label class="visually-hidden" for="type-filter">Type</label>
      <select id="type-filter"><option value="">All types</option></select>
      <output id="result-count" aria-live="polite">—</output>
    </div>
    <div class="ledger-head" aria-hidden="true">
      <span>Model</span><span>Display name</span><span>Provider</span><span>Types</span><span>Released · updated</span><span>Context</span><span>Input cost</span><span>Output cost</span><span>Cached cost</span>
    </div>
    <div class="ledger" id="ledger" aria-live="polite"><p class="loading">Loading…</p></div>
  </main>
  <dialog id="model-dialog" aria-labelledby="dialog-title">
    <form method="dialog"><button class="dialog-close" aria-label="Close model details">Close</button></form>
    <div id="dialog-content"></div>
  </dialog>
`;

function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T {
  const value = document.querySelector(`#${id}`);
  if (!(value instanceof constructor)) throw new Error(`Missing #${id}`);
  return value;
}

const search = element("search", HTMLInputElement);
const providerFilter = element("provider-filter", HTMLSelectElement);
const typeFilter = element("type-filter", HTMLSelectElement);
const ledger = element("ledger", HTMLDivElement);
const resultCount = element("result-count", HTMLOutputElement);
const modelCount = element("model-count", HTMLSpanElement);
const syncState = element("sync-state", HTMLDivElement);
const catalogVersion = element("catalog-version", HTMLSpanElement);
const dialog = element("model-dialog", HTMLDialogElement);
const dialogContent = element("dialog-content", HTMLDivElement);

let models: ProviderModel[] = [];
let sources = new Map<string, SourceRecord>();

function appendText(
  parent: HTMLElement,
  tag: keyof HTMLElementTagNameMap,
  text: string,
  className?: string,
): HTMLElement {
  const child = document.createElement(tag);
  child.textContent = text;
  if (className !== undefined) child.className = className;
  parent.append(child);
  return child;
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? "—"
    : new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function typeLabel(value: ProviderModel["types"][number]): string {
  switch (value) {
    case "audio_generation":
      return "audio/generation";
    case "audio_speech":
      return "audio/speech";
    case "audio_transcription":
      return "audio/transcription";
    case "audio_translation":
      return "audio/translation";
    default:
      return value;
  }
}

function modelDates(model: ProviderModel): string {
  if (model.release_date !== undefined && model.updated_date !== undefined)
    return `${model.release_date} · ${model.updated_date}`;
  return model.release_date ?? model.updated_date ?? "—";
}

function rate(model: ProviderModel, meter: PriceRate["meter"]): PriceRate | undefined {
  return (
    model.pricing.find(
      (item) => item.meter === meter && Object.keys(item.conditions).length === 0,
    ) ?? model.pricing.find((item) => item.meter === meter)
  );
}

function price(model: ProviderModel, meter: PriceRate["meter"]): string {
  const item = rate(model, meter);
  if (item === undefined) return "—";
  return item.currency === "USD" ? `$${item.price}` : `${item.currency} ${item.price}`;
}

function showDetails(model: ProviderModel): void {
  dialogContent.replaceChildren();
  const heading = appendText(dialogContent, "p", model.provider_id, "overline");
  heading.id = "dialog-title";
  const hasDisplayName = model.name !== model.model_id;
  appendText(dialogContent, "h2", hasDisplayName ? model.name : model.model_id);
  if (hasDisplayName) appendText(dialogContent, "code", model.model_id, "model-id");
  if (model.description !== undefined)
    appendText(dialogContent, "p", model.description, "dialog-description");

  const definition = document.createElement("dl");
  const entries = [
    ["Version", model.version ?? "default / unspecified"],
    ["Types", model.types.map(typeLabel).join(", ")],
    [
      "API endpoints",
      model.api_endpoints?.map(({ name, path }) => `${name} (${path})`).join(", ") ??
        "not published",
    ],
    ["Released", model.release_date ?? "unknown"],
    ["Updated", model.updated_date ?? "unknown"],
    ["Input", model.modalities.input.join(", ") || "unknown"],
    ["Output", model.modalities.output.join(", ") || "unknown"],
    ["Context", formatNumber(model.limits.context_tokens)],
    ["Status", model.status],
    [
      "Deployments",
      model.availability === undefined
        ? "unknown"
        : `${model.availability.length} region / deployment-type pairs`,
    ],
    ["Account availability", model.account_availability],
  ];
  for (const [term, value] of entries) {
    appendText(definition, "dt", term ?? "");
    appendText(definition, "dd", value ?? "");
  }
  dialogContent.append(definition);

  if (model.pricing.length > 0) {
    appendText(dialogContent, "h3", "Published rates");
    const rates = document.createElement("div");
    rates.className = "rates";
    for (const item of model.pricing) {
      const condition = Object.entries(item.conditions)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(" · ");
      appendText(rates, "span", item.meter);
      appendText(rates, "strong", `${item.currency} ${item.price} / ${item.unit}`);
      appendText(rates, "small", condition || "standard conditions");
    }
    dialogContent.append(rates);
  }

  appendText(dialogContent, "h3", "Sources");
  const sourceList = document.createElement("ul");
  sourceList.className = "source-list";
  for (const id of model.source_refs) {
    const source = sources.get(id);
    if (source === undefined) continue;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${source.id} · ${source.source.join(" + ")} ↗`;
    item.append(link);
    sourceList.append(item);
  }
  dialogContent.append(sourceList);
  dialog.showModal();
}

function modelRow(model: ProviderModel): HTMLButtonElement {
  const row = document.createElement("button");
  row.className = "model-row";
  row.type = "button";
  row.setAttribute(
    "aria-label",
    `View ${model.name === model.model_id ? model.model_id : model.name} details`,
  );
  const identity = document.createElement("span");
  appendText(
    identity,
    "code",
    `${model.model_id}${model.version === undefined ? "" : ` @ ${model.version}`}`,
  );
  row.append(identity);
  appendText(row, "span", model.name === model.model_id ? "" : model.name, "display-name");
  appendText(row, "span", model.provider_id, "provider-name");
  appendText(row, "span", model.types.map(typeLabel).join(" · "), "model-type");
  appendText(row, "span", modelDates(model), "model-dates");
  appendText(row, "span", formatNumber(model.limits.context_tokens), "numeric");
  appendText(row, "span", price(model, "input_text"), "numeric price");
  appendText(row, "span", price(model, "output_text"), "numeric price");
  appendText(row, "span", price(model, "cache_read_text"), "numeric price");
  row.addEventListener("click", () => showDetails(model));
  return row;
}

function render(): void {
  const query = search.value.trim().toLocaleLowerCase();
  const provider = providerFilter.value;
  const type = typeFilter.value;
  const visible = models.filter(
    (model) =>
      (query === "" ||
        `${model.name} ${model.model_id} ${model.version ?? ""} ${model.provider_id} ${model.types.join(" ")} ${(model.api_endpoints ?? []).flatMap(({ name, path }) => [name, path]).join(" ")}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (provider === "" || model.provider_id === provider) &&
      (type === "" || model.types.some((value) => value === type)),
  );
  ledger.replaceChildren(...visible.map(modelRow));
  if (visible.length === 0)
    appendText(ledger, "p", "No observed model matches these filters.", "empty");
  resultCount.textContent = `${visible.length} / ${models.length}`;
  resultCount.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
}

function option(value: string, label: string): HTMLOptionElement {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

async function loadCatalog(): Promise<void> {
  try {
    const response = await fetch("/v1/catalog/index.json", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
    const value: unknown = await response.json();
    const catalog = catalogEnvelopeSchema.parse(value);
    models = catalog.data.models;
    sources = new Map(catalog.data.sources.map((source) => [source.id, source]));
    const providerIds = [...new Set(models.map((model) => model.provider_id))].sort();
    providerFilter.append(...providerIds.map((id) => option(id, id)));
    const types = [...new Set(models.flatMap((model) => model.types))].sort();
    typeFilter.append(...types.map((type) => option(type, typeLabel(type))));
    modelCount.textContent = new Intl.NumberFormat("en").format(models.length);
    catalogVersion.textContent = catalog.catalog_version.slice(0, 8);
    const fresh = catalog.data.coverage.filter((item) => item.status === "fresh").length;
    const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(catalog.generated_at),
    );
    syncState.replaceChildren();
    appendText(syncState, "span", "", "status-dot");
    appendText(syncState, "span", `${fresh}/${catalog.data.providers.length} fresh · ${time}`);
    syncState.classList.add("ready");
    render();
  } catch (error) {
    ledger.replaceChildren();
    appendText(
      ledger,
      "p",
      error instanceof Error ? error.message : "Catalog unavailable",
      "empty error",
    );
    syncState.replaceChildren();
    appendText(syncState, "span", "", "status-dot");
    appendText(syncState, "span", "Catalog unavailable");
    syncState.classList.add("failed");
  }
}

for (const control of [search, providerFilter, typeFilter])
  control.addEventListener("input", render);
void loadCatalog();
