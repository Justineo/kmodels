import { markdownProse, markdownSection } from "./markdown.ts";
import type { InvocationTarget } from "./invocation-schema.ts";
import type { ModelTask } from "./schema.ts";

export const openAiWebSocketContracts = [
  {
    url: "https://developers.openai.com/api/reference/resources/realtime/methods/connect.md",
    path: "/v1/realtime",
    name: "Realtime",
    task: "speech_to_speech",
  },
  {
    url: "https://developers.openai.com/api/reference/resources/realtime/subresources/translations/methods/connect.md",
    path: "/v1/realtime/translations",
    name: "Realtime translation",
    task: "translation",
  },
] as const;

export interface OpenAiWebSocketWire {
  path: string;
  name: string;
  task: ModelTask;
  selectors: InvocationTarget["selectors"];
}

/** A model-based opening handshake is distinct from joining a call or creating a client secret. */
export function openAiWebSocketWire(url: string, body: string): OpenAiWebSocketWire | undefined {
  const contract = openAiWebSocketContracts.find((entry) => entry.url === url);
  const section = markdownSection(markdownProse(body), 2, "Connect");
  if (contract === undefined || section === undefined) return;
  const urls = section.split(/\r?\n/).filter((line) => line.startsWith("**WebSocket** "));
  const authentication = markdownSection(section, 3, "Authentication")?.trim();
  const parameters = markdownSection(section, 3, "Connection parameters");
  if (
    urls.length !== 1 ||
    urls[0] !== `**WebSocket** \`wss://api.openai.com${contract.path}\`` ||
    authentication !== "Use Bearer Auth (header Authorization)." ||
    parameters === undefined
  )
    return;
  const fields = parameters.split(/\r?\n/).filter((line) => line.startsWith("- "));
  const realtime = contract.path === "/v1/realtime";
  if (realtime) {
    if (
      !section.includes(
        "To start a Realtime conversation, set `model` in the connection URL. To join an existing call, set `call_id` instead.",
      ) ||
      fields.join("\n") !==
        "- `model` (query, string, optional)\n- `call_id` (query, string, optional)\n- `intent` (query, enum, optional): realtime, transcription"
    )
      return;
  } else if (parameters.trim() !== "- `model` (query, string, required)") return;
  return {
    path: contract.path,
    name: contract.name,
    task: contract.task,
    selectors: realtime
      ? [
          {
            location: { kind: "query", key: "intent" },
            value: { kind: "literal", value: "realtime" },
          },
        ]
      : [],
  };
}
