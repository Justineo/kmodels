/**
 * Sealed credential-bearing transport layer.
 *
 * SECURITY BOUNDARY: This module is the sole owner of secret-reading cloud & API transports.
 * It must NEVER import provider HTML/Markdown/pricing parsers, `cheerio`, or `manifests.ts`.
 * Autonomous self-healing workflows cannot modify this directory.
 */
import { createSign } from "node:crypto";
import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import { z } from "zod";
import { azureModelLocations } from "../azure-locations.ts";
import { mapConcurrent } from "../concurrency.ts";
import { assertItemCount, assertSourceConstraint, recognizeValue } from "../source-contract.ts";
import { cloudJson, runCurl, type TransportAuth, type TransportSource } from "./http.ts";

export interface AzureModelsTransportConfig {
  subscriptionEnv: string;
  concurrency: number;
  maxLocations: number;
  maxModels: number;
  maxModelsPerLocation: number;
}

export interface GoogleModelGardenTransportConfig {
  publishers: readonly string[];
  pageSize: number;
  maxPages: number;
  maxModelsPerPublisher: number;
  concurrency: number;
}

const azureTokenSchema = z.object({ access_token: z.string().min(1) });
const azureArmPageSchema = z.object({
  value: z.array(z.unknown()),
  nextLink: z.string().nullable().optional(),
});
const googleServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key_id: z.string().min(1).optional(),
  private_key: z.string().min(1),
  client_email: z.email(),
  token_uri: z.literal("https://oauth2.googleapis.com/token"),
});
const googleTokenSchema = z.object({ access_token: z.string().min(1) });
const googleModelsPageSchema = z.object({
  publisherModels: z.array(z.unknown()).default([]),
  nextPageToken: z.string().min(1).optional(),
});

function environment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Missing credential ${name}`);
  return value;
}

const DATABRICKS_HOST_SUFFIXES = [
  ".cloud.databricks.com",
  ".azuredatabricks.net",
  ".gcp.databricks.com",
] as const;

/**
 * Sealed credential-to-destination allowlist enforced inside `src/catalog/transport/`.
 * Even if an external caller passes an arbitrary URL with a credential spec, credentials
 * can never be transmitted to an unreviewed host.
 */
const CREDENTIAL_HOST_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  ANTHROPIC_API_KEY: ["api.anthropic.com"],
  CEREBRAS_API_KEY: ["api.cerebras.ai"],
  COHERE_API_KEY: ["api.cohere.com"],
  DASHSCOPE_API_KEY: ["dashscope-intl.aliyuncs.com"],
  DEEPSEEK_API_KEY: ["api.deepseek.com"],
  GEMINI_API_KEY: ["generativelanguage.googleapis.com"],
  MISTRAL_API_KEY: ["api.mistral.ai", "api.eu.mistral.ai", "api.us.mistral.ai"],
  MOONSHOT_API_KEY: ["api.moonshot.ai"],
  MOONSHOT_CN_API_KEY: ["api.moonshot.cn"],
  OPENAI_API_KEY: ["api.openai.com"],
  TOGETHER_API_KEY: ["api.together.ai"],
  XAI_API_KEY: ["api.x.ai"],
};

function assertCredentialDestinationAllowed(
  url: URL,
  auth: TransportAuth,
): asserts auth is Extract<TransportAuth, { scheme: "bearer" | "header" }> {
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    throw new Error("Authenticated transport requires a clean HTTPS origin");
  }
  if (
    auth.scheme === "aws" ||
    auth.scheme === "azure" ||
    auth.scheme === "google-service-account"
  ) {
    throw new Error("Cloud sources require their reviewed authenticated transport");
  }
  const hostname = url.hostname.toLowerCase();
  if (auth.env === "DATABRICKS_TOKEN") {
    if (!DATABRICKS_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      throw new Error(`Credential ${auth.env} is not allowed for host ${hostname}`);
    }
    return;
  }
  const allowedHosts = CREDENTIAL_HOST_ALLOWLIST[auth.env];
  if (allowedHosts === undefined || !allowedHosts.includes(hostname)) {
    throw new Error(`Credential ${auth.env} is not allowed for host ${hostname}`);
  }
}

function authHeaderFor(auth: Extract<TransportAuth, { scheme: "bearer" | "header" }>): string {
  const credential = environment(auth.env);
  return auth.scheme === "bearer"
    ? `Authorization: Bearer ${credential}`
    : `${auth.header}: ${credential}`;
}

/**
 * Execute an authenticated HTTPS request inside the sealed transport boundary so
 * raw credential values never leave `src/catalog/transport/` and credentials are
 * strictly bound to their reviewed destination hosts.
 */
export async function runAuthenticatedCurl(
  url: URL,
  auth: TransportAuth,
  options: Parameters<typeof runCurl>[1],
): Promise<Response> {
  assertCredentialDestinationAllowed(url, auth);
  return runCurl(url, {
    ...options,
    headers: [...options.headers, authHeaderFor(auth)],
  });
}

export function databricksSource<T extends TransportSource>(source: T, hostEnv: string): T {
  const raw = environment(hostEnv);
  const origin = new URL(raw);
  const hostname = origin.hostname.toLowerCase();
  if (
    origin.protocol !== "https:" ||
    origin.port !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    (origin.pathname !== "" && origin.pathname !== "/") ||
    origin.search !== "" ||
    origin.hash !== "" ||
    !DATABRICKS_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  )
    throw new Error("DATABRICKS_HOST is not a reviewed Databricks workspace origin");
  const url = new URL("/api/2.0/serving-endpoints", origin);
  return { ...source, url: url.href, allowedHosts: [hostname] };
}

export async function fetchBedrockInventory(region: string, maxBytes: number): Promise<string> {
  const client = new BedrockClient({ region, maxAttempts: 3 });
  try {
    const result = await client.send(new ListFoundationModelsCommand({}), {
      abortSignal: AbortSignal.timeout(20_000),
    });
    if (result.modelSummaries === undefined || result.modelSummaries.length === 0)
      throw new Error("Bedrock API returned an empty model list");
    const body = JSON.stringify({ modelSummaries: result.modelSummaries });
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Bedrock API exceeded byte limit");
    return body;
  } finally {
    client.destroy();
  }
}

function azurePageUrl(raw: string, pathPrefix: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "management.azure.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.toLowerCase().startsWith(pathPrefix.toLowerCase())
  )
    throw new Error("Azure pagination left the reviewed ARM endpoint");
  return url;
}

async function fetchAzureArmItems(
  maxResponseBytes: number,
  label: string,
  first: URL,
  path: string,
  headers: readonly string[],
  limits: { items: number; pages: number },
): Promise<unknown[]> {
  const items: unknown[] = [];
  let next: URL | undefined = first;
  let pages = 0;
  while (next !== undefined) {
    if (pages === limits.pages) throw new Error(`${label} exceeded page limit`);
    const page: z.infer<typeof azureArmPageSchema> = recognizeValue(
      label,
      azureArmPageSchema,
      await cloudJson(label, next, maxResponseBytes, headers),
    );
    items.push(...page.value);
    if (items.length > limits.items) throw new Error(`${label} exceeded item limit`);
    next =
      page.nextLink === undefined || page.nextLink === null
        ? undefined
        : azurePageUrl(page.nextLink, path);
    pages += 1;
  }
  return items;
}

export async function fetchAzureModels(
  source: Pick<TransportSource, "auth" | "maxResponseBytes">,
  transport: AzureModelsTransportConfig,
): Promise<string> {
  const auth = source.auth;
  if (auth?.scheme !== "azure") throw new Error("Azure transport requires Azure credentials");
  const [tenantEnv, clientEnv, secretEnv] = auth.envs;
  const tenant = environment(tenantEnv);
  const client = environment(clientEnv);
  const secret = environment(secretEnv);
  const subscription = environment(transport.subscriptionEnv);
  if (!/^[0-9a-f-]{36}$/i.test(tenant) || !/^[0-9a-f-]{36}$/i.test(client))
    throw new Error("Azure tenant and client IDs must be GUIDs");
  if (!/^[0-9a-f-]{36}$/i.test(subscription)) throw new Error("Azure subscription is invalid");

  const tokenUrl = new URL(`/${tenant}/oauth2/v2.0/token`, "https://login.microsoftonline.com");
  const token = azureTokenSchema.parse(
    await cloudJson("Azure", tokenUrl, 1024 * 1024, ["Accept: application/json"], {
      form: [
        { name: "client_id", value: client },
        { name: "client_secret", value: secret },
        { name: "grant_type", value: "client_credentials" },
        { name: "scope", value: "https://management.azure.com/.default" },
      ],
    }),
  );
  const authorizationHeaders = [
    "Accept: application/json",
    `Authorization: Bearer ${token.access_token}`,
  ];
  const resourceTypesUrl = new URL(
    `/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/resourceTypes?api-version=2021-04-01`,
    "https://management.azure.com",
  );
  const subscriptionLocationsPath = `/subscriptions/${subscription}/locations`;
  const subscriptionLocationsUrl = new URL(
    `${subscriptionLocationsPath}?api-version=2022-12-01`,
    "https://management.azure.com",
  );
  const subscriptionLocations = await fetchAzureArmItems(
    source.maxResponseBytes,
    "Azure subscription locations",
    subscriptionLocationsUrl,
    subscriptionLocationsPath,
    authorizationHeaders,
    { items: 1_000, pages: 10 },
  );
  const resourceTypes = await cloudJson(
    "Azure Cognitive Services resource types",
    resourceTypesUrl,
    source.maxResponseBytes,
    authorizationHeaders,
  );
  const locations = azureModelLocations(resourceTypes, subscriptionLocations);
  if (locations.length > transport.maxLocations)
    throw new Error("Azure Models API exceeded location limit");

  const regions = await mapConcurrent(locations, transport.concurrency, async (location) => {
    const path = `/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/locations/${location}/models`;
    const first = new URL(`${path}?api-version=2025-06-01`, "https://management.azure.com");
    const models = await fetchAzureArmItems(
      source.maxResponseBytes,
      `Azure Models (${location})`,
      first,
      path,
      authorizationHeaders,
      { items: transport.maxModelsPerLocation, pages: 20 },
    );
    return { location, models };
  });
  const modelCount = regions.reduce((sum, { models }) => sum + models.length, 0);
  assertItemCount("Azure Models API", modelCount, 1);
  if (modelCount > transport.maxModels)
    throw new Error("Azure Models API exceeded total item limit");

  const body = JSON.stringify({ regions });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Azure inventory bundle exceeded byte limit");
  return body;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function googleAccessToken(
  source: Pick<TransportSource, "auth">,
): Promise<{ token: string; project: string }> {
  const auth = source.auth;
  if (auth?.scheme !== "google-service-account")
    throw new Error("Google transport requires service-account credentials");
  let parsed: unknown;
  try {
    parsed = JSON.parse(environment(auth.env));
  } catch {
    throw new Error("Google service-account JSON is invalid");
  }
  const account = googleServiceAccountSchema.parse(parsed);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
      ...(account.private_key_id === undefined ? {} : { kid: account.private_key_id }),
    }),
  );
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: account.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(account.private_key);
  const assertion = `${unsigned}.${signature.toString("base64url")}`;
  const token = googleTokenSchema.parse(
    await cloudJson(
      "Google OAuth",
      new URL(account.token_uri),
      1024 * 1024,
      ["Accept: application/json"],
      {
        authentication: true,
        form: [
          { name: "grant_type", value: "urn:ietf:params:oauth:grant-type:jwt-bearer" },
          { name: "assertion", value: assertion },
        ],
      },
    ),
  );
  return { token: token.access_token, project: account.project_id };
}

export async function fetchGoogleModelGarden(
  source: Pick<TransportSource, "auth" | "maxResponseBytes">,
  transport: GoogleModelGardenTransportConfig,
): Promise<string> {
  if (
    !Number.isInteger(transport.pageSize) ||
    transport.pageSize <= 0 ||
    !Number.isInteger(transport.maxPages) ||
    transport.maxPages <= 0 ||
    !Number.isInteger(transport.maxModelsPerPublisher) ||
    transport.maxModelsPerPublisher <= 0 ||
    !Number.isInteger(transport.concurrency) ||
    transport.concurrency <= 0
  )
    throw new Error("Invalid Model Garden transport bounds");
  const credential = await googleAccessToken(source);
  const results = await mapConcurrent(
    transport.publishers,
    transport.concurrency,
    async (publisher) => {
      if (!/^[a-z0-9-]+$/.test(publisher)) throw new Error("Invalid Model Garden publisher");
      const models: unknown[] = [];
      let pageToken: string | undefined;
      const requestedPageTokens = new Set<string>();
      for (let pageCount = 0; pageCount < transport.maxPages; pageCount += 1) {
        if (pageToken !== undefined) {
          assertSourceConstraint(
            "Model Garden publisher repeated a page token",
            !requestedPageTokens.has(pageToken),
            pageToken,
            ["nextPageToken"],
          );
          requestedPageTokens.add(pageToken);
        }
        const url = new URL(
          `/v1beta1/publishers/${publisher}/models`,
          "https://aiplatform.googleapis.com",
        );
        url.searchParams.set("pageSize", String(transport.pageSize));
        url.searchParams.set("view", "PUBLISHER_MODEL_VIEW_BASIC");
        url.searchParams.set("languageCode", "en");
        url.searchParams.set("listAllVersions", "false");
        if (pageToken !== undefined) url.searchParams.set("pageToken", pageToken);
        const page = recognizeValue(
          "Google Model Garden",
          googleModelsPageSchema,
          await cloudJson("Google Model Garden", url, source.maxResponseBytes, [
            "Accept: application/json",
            `Authorization: Bearer ${credential.token}`,
            `x-goog-user-project: ${credential.project}`,
          ]),
        );
        models.push(...page.publisherModels);
        if (models.length > transport.maxModelsPerPublisher)
          throw new Error("Model Garden publisher exceeded item limit");
        pageToken = page.nextPageToken;
        if (pageToken === undefined) break;
        if (pageCount === transport.maxPages - 1)
          throw new Error("Model Garden publisher exceeded page limit");
      }
      return { publisher, models };
    },
  );
  assertItemCount(
    "Agent Platform Model Garden API",
    results.reduce((count, result) => count + result.models.length, 0),
    1,
  );
  const body = JSON.stringify({ publishers: results });
  if (Buffer.byteLength(body) > source.maxResponseBytes)
    throw new Error("Agent Platform Model Garden inventory exceeded byte limit");
  return body;
}
