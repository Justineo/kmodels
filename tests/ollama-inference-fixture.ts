import { readFile } from "node:fs/promises";
import { z } from "zod";

const document = z.object({ url: z.url(), body: z.string() });
const bundleSchema = z.object({
  list: z.object({ models: z.array(z.object({ model: z.string() }).loose()) }).loose(),
  catalog: document,
  pages: z.array(z.unknown()),
  details: z.array(z.unknown()),
  documents: z.array(document),
});
export type OllamaInferenceBundle = z.infer<typeof bundleSchema>;
export async function ollamaInferenceFixtures() {
  const [cloud, library] = await Promise.all([
    readFile(new URL("./fixtures/ollama/inference-current.json", import.meta.url), "utf8"),
    readFile(new URL("./fixtures/ollama/inference-current-library.html", import.meta.url), "utf8"),
  ]);
  return { cloud: bundleSchema.parse(JSON.parse(cloud)), library };
}
