---
title: Data residency
url: https://platform.claude.com/docs/en/manage-claude/data-residency
description: Manage where model inference runs and where data is stored with geographic controls.
featureMetadata:
  status: ga
  zdr:
    eligibility: eligible
    note: Excludes [Covered Models](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements).
  supportedModels:
    - claude-fable-5-1
    - claude-mythos-5-1
    - claude-fable-5
    - claude-mythos-5
    - claude-mythos-preview
    - claude-opus-5-5
    - claude-opus-5
    - claude-sonnet-5-5
    - claude-sonnet-5
    - claude-haiku-5-5
    - claude-opus-4-8
    - claude-opus-4-7
    - claude-opus-4-6
    - claude-sonnet-4-6
  supportedPlatforms:
    Claude API: ga
    Claude Platform on AWS:
      availability: ga
      note: Workspace geo is not configurable; Managed Agents sessions there run with workspace geo "us".
    Claude Models on Google Cloud (Anthropic managed):
      availability: ga
      note: Workspace geo is not configurable.
---

**API support**: Usage differs by product.

- **Messages API**: Set `inference_geo` on each request, or set a default for the workspace.
- **Managed Agents**: Pin `inference_geo` in the agent’s model configuration; override it at session creation.

Data residency controls let you manage where your data is processed and stored. Two independent settings govern this:

- **Inference geo:** Controls where model inference runs, on a per-request basis. Set through the `inference_geo` API parameter or as a workspace default.
- **Workspace geo:** Controls where data is stored at rest and where endpoint processing (such as image transcoding and code execution) occurs. Configured at the workspace level in the [Claude Console](https://platform.claude.com/).

<Note>
  [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) supports geographic pinning at the agent level: `inference_geo` on an [agent’s model configuration](https://platform.claude.com/docs/en/managed-agents/agent-setup#pin-the-inference-geo) pins the geography that serves model requests for sessions running that agent, with [per-session overrides](https://platform.claude.com/docs/en/managed-agents/sessions#pin-the-inference-geo-for-a-session) at session create. Agents without a pin follow the workspace’s default inference geo on each request. Managed Agents also respects the Workspace geo configured in Console, and with [self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes), tool execution and the sandbox filesystem stay on infrastructure you control; the contents of attached [memory stores](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes-memory) remain stored by Anthropic and are copied to your sandbox for the session.
</Note>

## Inference geo

The `inference_geo` parameter controls where model inference runs for a specific API request. Add it to any `POST /v1/messages` call.

| Value      | Description                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `"global"` | Default. Inference may run in any available geography for optimal performance and availability. |
| `"us"`     | Inference runs only in US-based infrastructure.                                                 |

### API usage

<CodeGroup>
  ```bash cURL
  curl https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d '{
      "model": "claude-opus-5-5",
      "max_tokens": 1024,
      "inference_geo": "us",
      "messages": [{
        "role": "user",
        "content": "Summarize the key points of this document."
      }]
    }'
  ```

```bash CLI
ant messages create \
  --model claude-opus-5-5 \
  --max-tokens 1024 \
  --inference-geo us \
  --message '{role: user, content: "Summarize the key points of this document."}'
```

```python Python
client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=1024,
    inference_geo="us",
    messages=[
        {"role": "user", "content": "Summarize the key points of this document."}
    ],
)

for block in response.content:
    if block.type == "text":
        print(block.text)
# Check where inference actually ran
print(f"Inference geo: {response.usage.inference_geo}")
```

```typescript TypeScript
const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 1024,
  inference_geo: "us",
  messages: [
    {
      role: "user",
      content: "Summarize the key points of this document.",
    },
  ],
});

const textBlock = response.content.find((block) => block.type === "text");
console.log(textBlock?.text);
// Check where inference actually ran
console.log(`Inference geo: ${response.usage.inference_geo}`);
```

```csharp C#
var client = new AnthropicClient();

var response = await client.Messages.Create(
    new MessageCreateParams
    {
        Model = Model.ClaudeOpus5_5,
        MaxTokens = 1024,
        InferenceGeo = "us",
        Messages =
        [
            new UserMessageParam { Content = "Summarize the key points of this document." },
        ],
    }
);

foreach (var block in response.Content)
{
    if (block.TryPickText(out var textBlock))
    {
        Console.WriteLine(textBlock.Text);
    }
}

// Check where inference actually ran
Console.WriteLine($"Inference geo: {response.Usage.InferenceGeo}");
```

```go Go
client := anthropic.NewClient()

message, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
	Model:        anthropic.ModelClaudeOpus5_5,
	MaxTokens:    1024,
	InferenceGeo: anthropic.String("us"),
	Messages: []anthropic.MessageParam{
		anthropic.NewUserMessage(anthropic.NewTextBlock("Summarize the key points of this document.")),
	},
})
if err != nil {
	log.Fatal(err)
}

for _, block := range message.Content {
	if textBlock, ok := block.AsAny().(anthropic.TextBlock); ok {
		fmt.Println(textBlock.Text)
	}
}
// Check where inference actually ran
fmt.Printf("Inference geo: %s\n", message.Usage.InferenceGeo)
```

```java Java
AnthropicClient client = AnthropicOkHttpClient.fromEnv();

Message response = client.messages().create(
    MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_5_5)
        .maxTokens(1024L)
        .inferenceGeo("us")
        .addUserMessage("Summarize the key points of this document.")
        .build());

response.content().stream()
    .flatMap(block -> block.text().stream())
    .forEach(textBlock -> IO.println(textBlock.text()));
// Check where inference actually ran
IO.println("Inference geo: " + response.usage().inferenceGeo().get());
```

```php PHP
$client = new Client();

$response = $client->messages->create(
    model: 'claude-opus-5-5',
    maxTokens: 1024,
    inferenceGeo: 'us',
    messages: [
        ['role' => 'user', 'content' => 'Summarize the key points of this document.'],
    ],
);

foreach ($response->content as $block) {
    if ($block->type === 'text') {
        echo $block->text, PHP_EOL;
    }
}
// Check where inference actually ran
echo "Inference geo: {$response->usage->inferenceGeo}\n";
```

```ruby Ruby
client = Anthropic::Client.new

response = client.messages.create(
  model: Anthropic::Model::CLAUDE_OPUS_5_5,
  max_tokens: 1024,
  inference_geo: "us",
  messages: [
    {role: "user", content: "Summarize the key points of this document."}
  ]
)

response.content.each do |block|
  puts block.text if block.type == :text
end
# Check where inference actually ran
puts "Inference geo: #{response.usage.inference_geo}"
```

</CodeGroup>

### Response

The response `usage` object includes an `inference_geo` field indicating where inference ran:

```json Output
{
  "usage": {
    "input_tokens": 25,
    "output_tokens": 150,
    "inference_geo": "us"
  }
}
```

### Model availability

The `inference_geo` parameter is supported on Claude 4.6 and later models. Requests with `inference_geo` on Claude Opus 4.5, Claude Sonnet 4.5 (deprecated), Claude Haiku 4.5, or earlier models return a 400 error.

<Note>
  The `inference_geo` parameter is available on the Claude API (first-party), [Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws), and [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed). On Amazon Bedrock and Claude Models on Google Cloud (Google managed), the inference region is determined by the endpoint URL or inference profile, so `inference_geo` is not applicable. On [Claude in Microsoft Foundry](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry), `inference_geo` is likewise not applicable: deployments hosted on Azure can instead use the US Data Zone Standard deployment type, which keeps inference within the United States. The `inference_geo` parameter is also not available through the [OpenAI SDK compatibility endpoint](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk).
</Note>

### Workspace-level restrictions

Workspace settings also support restricting which inference geos are available:

- **`allowed_inference_geos`:** Restricts which geos a workspace can use. If a request specifies an `inference_geo` not in this list, the API returns an error.
- **`default_inference_geo`:** Sets the fallback geo when `inference_geo` is omitted from a request. Individual requests can override this by setting `inference_geo` explicitly.

These settings can be configured through the Console or the [Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api) under the `data_residency` field.

<Note>
  **Claude Models on Google Cloud (Anthropic managed):** Every workspace allows all inference geos and uses `"global"` as its default inference geo. The Claude Console shows both settings as read-only. For US-only inference, set `inference_geo: "us"` on each request.
</Note>
