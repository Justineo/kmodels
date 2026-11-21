import { load } from "cheerio";
import { z } from "zod";
import { markdownProse } from "../../src/catalog/markdown.ts";
import { digest, type MaintenanceState } from "./state.ts";

/** Structural leads never assert that a tariff exists or that a parser is incorrect. */
export function sourceShape(body: string): string[] {
  const texts = [body];
  if (body.trimStart().startsWith("{")) {
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      value = undefined;
    }
    const bundle = z
      .object({
        index: z.object({ body: z.string() }),
        documents: z.array(z.object({ body: z.string() })).max(10000),
      })
      .safeParse(value);
    if (bundle.success)
      texts.splice(
        0,
        1,
        bundle.data.index.body,
        ...bundle.data.documents.map((document) => document.body),
      );
  }
  const features = new Set<string>();
  for (const text of texts) {
    const prose = markdownProse(text);
    const html = load(prose);
    const relevant = /price|pricing|billing|cache|region|tier|model|token|cost/i;
    for (const element of html("h1,h2,h3,h4,th,a[href]").toArray()) {
      const label = html(element).text().replace(/\s+/g, " ").trim();
      if (relevant.test(label))
        features.add(
          `${element.tagName}:${label.slice(0, 160)}:${html(element).attr("href") ?? ""}`.slice(
            0,
            400,
          ),
        );
    }
    for (const match of prose.matchAll(/^#{1,4}[ \t]+(.+)$/gm))
      if (match[1] && relevant.test(match[1])) features.add(match[1].slice(0, 400));
    for (const [, label, href] of prose.matchAll(/\[([^\]\n]+)\]\(([^()\s]+)\)/gu))
      if (label && href && relevant.test(label))
        features.add(`a:${label.slice(0, 160)}:${href}`.slice(0, 400));
    for (const [, header] of prose.matchAll(
      /^(\|[^\n]+\|)[ \t]*\r?\n[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*\r?$/gmu,
    ))
      if (header && relevant.test(header)) features.add(`table:${header}`.slice(0, 400));
  }
  return [...features].sort();
}
export function recordDiscovery(
  state: MaintenanceState,
  provider: string,
  source: string,
  body: string,
  now: Date,
): void {
  const features = sourceShape(body);
  const hash = digest(JSON.stringify(features));
  const previous = state.observations[source];
  state.observations[source] = { hash, observed_at: now.toISOString() };
  if (!previous || previous.hash === hash) return;
  const id = `${provider}/discovery:${source}`;
  const existing = state.tasks.find((task) => task.id === id);
  const reason = `Official navigation, headings or tariff columns changed for ${source}. Inspect current source and compare consumed facts; this is a discovery lead, not a proven defect.`;
  if (existing) {
    existing.fingerprint = hash;
    existing.status = "pending";
    existing.reason = reason;
    existing.next_action = reason;
    existing.last_seen = now.toISOString();
    existing.coverage = [];
    delete existing.retry_at;
    delete existing.adopted_snapshot;
    delete existing.deployed_run;
  } else
    state.tasks.push({
      id,
      provider,
      trigger: "source_contract_change",
      fingerprint: hash,
      first_seen: now.toISOString(),
      last_seen: now.toISOString(),
      attempts: 0,
      status: "pending",
      reason,
      next_action: `Fetch the original ${source} and investigate changed structure.`,
      source_versions: {},
      coverage: [],
    });
}
