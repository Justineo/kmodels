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
    <a class="brand" href="/" aria-label="Kmodels home">KMODELS<span aria-hidden="true">/</span></a>
    <div class="sync-state" id="sync-state"><span class="status-dot"></span><span>Loading catalog</span></div>
    <a class="method-link" href="#method">Method</a>
  </header>
  <main>
    <section class="overview" aria-labelledby="catalog-title">
      <div>
        <p class="eyebrow">Public provider catalog</p>
        <h1 id="catalog-title"><span id="model-count">—</span><small>observed models</small></h1>
      </div>
      <p class="scope">Official public sources. No credentials. No account-level availability claims.</p>
    </section>
    <section class="workspace" aria-label="Model catalog">
      <div class="controls">
        <label class="search-label" for="search">Search</label>
        <input id="search" type="search" placeholder="Model or provider" autocomplete="off" />
        <label class="visually-hidden" for="provider-filter">Provider</label>
        <select id="provider-filter"><option value="">All providers</option></select>
        <label class="visually-hidden" for="type-filter">Type</label>
        <select id="type-filter"><option value="">All types</option></select>
        <output id="result-count" aria-live="polite">—</output>
      </div>
      <div class="ledger-head" aria-hidden="true">
        <span>Model</span><span>Provider</span><span>Type</span><span>Context</span><span>Input / output</span>
      </div>
      <div class="ledger" id="ledger" aria-live="polite"><p class="loading">Validating catalog…</p></div>
    </section>
    <section class="method" id="method" aria-labelledby="method-title">
      <p class="eyebrow">Method</p>
      <h2 id="method-title">Observed, not inferred.</h2>
      <div class="method-copy">
        <p>Every published field points to an allowlisted official source. A failed or suspicious refresh keeps the last validated provider catalog.</p>
        <p>Prices preserve their original conditions. Missing prices are unknown—not zero. Model names are never merged across providers.</p>
      </div>
      <a href="/v1/catalog/index.json">Raw catalog JSON <span aria-hidden="true">↗</span></a>
    </section>
  </main>
  <footer><span>Kmodels</span><span id="catalog-version">Catalog —</span></footer>
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

function rate(model: ProviderModel, meter: PriceRate["meter"]): PriceRate | undefined {
  return (
    model.pricing.find(
      (item) => item.meter === meter && Object.keys(item.conditions).length === 0,
    ) ?? model.pricing.find((item) => item.meter === meter)
  );
}

function price(model: ProviderModel): string {
  const input = rate(model, "input_text")?.price;
  const output = rate(model, "output_text")?.price;
  if (input === undefined && output === undefined) return "—";
  return `$${input ?? "—"} / $${output ?? "—"}`;
}

function showDetails(model: ProviderModel): void {
  dialogContent.replaceChildren();
  const heading = appendText(dialogContent, "p", model.provider_id, "eyebrow");
  heading.id = "dialog-title";
  appendText(dialogContent, "h2", model.name);
  appendText(dialogContent, "code", model.model_id, "model-id");
  if (model.description !== undefined)
    appendText(dialogContent, "p", model.description, "dialog-description");

  const definition = document.createElement("dl");
  const entries = [
    ["Type", model.types.join(", ")],
    ["Input", model.modalities.input.join(", ") || "unknown"],
    ["Output", model.modalities.output.join(", ") || "unknown"],
    ["Context", formatNumber(model.limits.context_tokens)],
    ["Status", model.status],
    ["Availability", model.account_availability],
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
    link.textContent = `${source.id} ↗`;
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
  row.setAttribute("aria-label", `View ${model.name} details`);
  const identity = document.createElement("span");
  appendText(identity, "strong", model.name);
  appendText(identity, "code", model.model_id);
  row.append(identity);
  appendText(row, "span", model.provider_id, "provider-name");
  appendText(row, "span", model.types.join(" · "), "model-type");
  appendText(row, "span", formatNumber(model.limits.context_tokens), "numeric");
  appendText(row, "span", price(model), "numeric price");
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
        `${model.name} ${model.model_id} ${model.provider_id}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (provider === "" || model.provider_id === provider) &&
      (type === "" || model.types.some((value) => value === type)),
  );
  ledger.replaceChildren(...visible.map(modelRow));
  if (visible.length === 0)
    appendText(ledger, "p", "No observed model matches these filters.", "empty");
  resultCount.textContent = `${visible.length} result${visible.length === 1 ? "" : "s"}`;
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
    typeFilter.append(...types.map((type) => option(type, type.replaceAll("_", " "))));
    modelCount.textContent = new Intl.NumberFormat("en").format(models.length);
    catalogVersion.textContent = `Catalog ${catalog.catalog_version.slice(0, 12)}`;
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
