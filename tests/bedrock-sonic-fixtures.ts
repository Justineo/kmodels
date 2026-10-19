import { readFile } from "node:fs/promises";

export function sonicBundle(documents: Array<{ url: string; body: string }>, url: string) {
  const index = documents.findIndex((document) => document.url === url);
  return JSON.stringify({
    index: documents[index] ?? { url, body: "<main></main>" },
    documents: documents.filter((_, i) => i !== index),
  });
}

export async function sonicDocuments() {
  return Promise.all(
    [
      [
        "https://docs.aws.amazon.com/nova/latest/userguide/output-events.html",
        "accounting-sonic1.html",
      ],
      [
        "https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html",
        "accounting-sonic2.html",
      ],
      [
        "https://docs.aws.amazon.com/bedrock/latest/userguide/models-api-compatibility.html",
        "accounting-sonic-models.html",
      ],
      [
        "https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithBidirectionalStream.html",
        "accounting-bidirectional.html",
      ],
    ].map(async ([url, file]) => {
      if (url === undefined || file === undefined)
        throw new Error("Missing Sonic fixture location");
      return {
        url,
        body: await readFile(new URL(`./fixtures/bedrock/${file}`, import.meta.url), "utf8"),
      };
    }),
  );
}
