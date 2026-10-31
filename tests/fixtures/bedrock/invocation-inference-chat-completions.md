# Chat Completions API

<a name="inference-chat-completions"></a>

The OpenAI Chat Completions API generates conversational responses using Amazon Bedrock models. Use the `bedrock-runtime` endpoint for new applications. Use `bedrock-mantle` only when a model or capability that you require isn't available on `bedrock-runtime`. For complete API details, see the [OpenAI Chat Completions documentation](https://developers.openai.com/api/reference/chat-completions/overview).

| **Endpoint**                   | **Base URL**                                                              | **Authentication**                                |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------- |
| bedrock-runtime (recommended)  | https://bedrock-runtime.{region}.amazonaws.com/openai/v1/chat/completions | AWS credentials (SigV4) or Amazon Bedrock API key |
| bedrock-mantle (compatibility) | https://bedrock-mantle.{region}.api.aws/v1/chat/completions               | Amazon Bedrock API key or AWS credentials         |

**Note**  
On `bedrock-mantle`, the path prefix varies by model. Most models are served under `/v1`, as shown in the preceding table, but some are served under `/openai/v1` instead. A request that uses the wrong prefix for a model is rejected with `model `<model-id>` isn't supported on this route`. To confirm the base URL for a specific model, see the **Programmatic Access** table on its card in [Models at a glance](model-cards.md).

Each endpoint has its own per-model token quotas. For details on the quotas applied to traffic on each endpoint, see [Quotas for the bedrock-runtime endpoint](quotas-runtime.md) and [Quotas for the bedrock-mantle endpoint](quotas-mantle.md).

## Chat Completions with the bedrock-runtime endpoint

<a name="inference-chat-completions-runtime-endpoint"></a>

The `bedrock-runtime` endpoint supports AWS SigV4 authentication and Amazon Bedrock API key authentication.

### Choose a model

<a name="inference-chat-completions-runtime-list-models"></a>

**Important**  
`bedrock-runtime` doesn't implement the OpenAI-compatible `GET /models` operation, so `client.models.list()` and `GET /openai/v1/models` don't work on this endpoint. Use [ListFoundationModels](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListFoundationModels.html), [ListInferenceProfiles](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListInferenceProfiles.html), and the endpoint-specific tables in [Models at a glance](model-cards.md). For examples, see [Get list of models](models-get-info.md).

**Note**  
The following examples use `openai.gpt-oss-120b-1:0`. GPT OSS models support Chat Completions on `bedrock-runtime`, but don't support the Responses API there. To use both OpenAI-compatible APIs on `bedrock-runtime`, choose a model whose model card lists both APIs as supported.

### Create a chat completion

<a name="inference-chat-completions-runtime-create"></a>

To create a chat completion, choose the tab for your preferred method, and then follow the steps:

---

#### [ OpenAI SDK (Python) ]

Configure the OpenAI client to point to the `bedrock-runtime` endpoint:

```
from openai import OpenAI
import os

client = OpenAI(
    base_url="https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
    api_key=os.environ.get("OPENAI_API_KEY")
)

response = client.chat.completions.create(
    model="openai.gpt-oss-120b-1:0",
    messages=[{"role": "user", "content": "Hello"}]
)
print(response.choices[0].message.content)
```

---

#### [ HTTP request (API key) ]

```
curl -X POST "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "openai.gpt-oss-120b-1:0",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

#### [ HTTP request (SigV4) ]

```
curl -X POST "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:us-east-1:bedrock" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -d '{
    "model": "openai.gpt-oss-120b-1:0",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## Chat Completions with the bedrock-mantle endpoint

<a name="inference-chat-completions-mantle-endpoint"></a>

Use `bedrock-mantle` as a compatibility option when a model or feature that you require isn't available on `bedrock-runtime`. The endpoint supports Amazon Bedrock API key authentication, AWS credentials, and the OpenAI SDK.

The examples in this section read the `OPENAI_BASE_URL` and `OPENAI_API_KEY` environment variables. Set them to the `bedrock-mantle` base URL and your Amazon Bedrock API key:

```
OPENAI_BASE_URL="https://bedrock-mantle.<your-region>.api.aws/v1"
OPENAI_API_KEY="<provide your Bedrock API key>"
```

**Important**  
Point `OPENAI_BASE_URL` at `bedrock-mantle` for these examples. Model cards set it to the `bedrock-runtime` base URL (`https://bedrock-runtime.{region}.amazonaws.com/openai/v1`), and `bedrock-runtime` doesn't implement the Models API, so listing models against that base URL returns `404 UnknownOperationException`.

### List available models

<a name="inference-chat-completions-mantle-list-models"></a>

The OpenAI-compatible Models API is available only on `bedrock-mantle`. To list models available on this endpoint, choose the tab for your preferred method, and then follow the steps:

---

#### [ OpenAI SDK (Python) ]

```
# List all available models using the OpenAI SDK
# Requires OPENAI_API_KEY and OPENAI_BASE_URL environment variables

from openai import OpenAI

client = OpenAI()

models = client.models.list()

for model in models.data:
    print(model.id)
```

---

#### [ HTTP request ]

```
# List all available models
# Requires OPENAI_API_KEY and OPENAI_BASE_URL environment variables

curl -X GET $OPENAI_BASE_URL/models \
   -H "Authorization: Bearer $OPENAI_API_KEY"
```

---

### Create a chat completion

<a name="inference-chat-completions-mantle-create"></a>

Choose the tab for your preferred method, and then follow the steps:

---

#### [ OpenAI SDK (Python) ]

Configure the OpenAI client using environment variables:

```
# Create a chat completion using the OpenAI SDK
# Requires OPENAI_API_KEY and OPENAI_BASE_URL environment variables

from openai import OpenAI

client = OpenAI()

completion = client.chat.completions.create(
    model="openai.gpt-oss-120b",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ]
)

print(completion.choices[0].message)
```

---

#### [ HTTP request ]

Make a POST request to `/v1/chat/completions`:

```
# Create a chat completion
# Requires OPENAI_API_KEY and OPENAI_BASE_URL environment variables

curl -X POST $OPENAI_BASE_URL/chat/completions \
   -H "Content-Type: application/json" \
   -H "Authorization: Bearer $OPENAI_API_KEY" \
   -d '{
    "model": "openai.gpt-oss-120b",
    "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ]
}'
```

---

**Streaming**  
To receive responses incrementally, choose the tab for your preferred method, and then follow the steps:

---

#### [ OpenAI SDK (Python) ]

```
# Stream chat completion responses incrementally using the OpenAI SDK
# Requires OPENAI_API_KEY and OPENAI_BASE_URL environment variables

from openai import OpenAI

client = OpenAI()

stream = client.chat.completions.create(
    model="openai.gpt-oss-120b",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="")
```

---

#### [ HTTP request ]

Make a POST request to `/v1/chat/completions` with `stream` set to `true`:

```
# Stream chat completion responses incrementally
# Requires OPENAI_API_KEY and OPENAI_BASE_URL environment variables

curl -X POST $OPENAI_BASE_URL/chat/completions \
   -H "Content-Type: application/json" \
   -H "Authorization: Bearer $OPENAI_API_KEY" \
   -d '{
    "model": "openai.gpt-oss-120b",
    "messages": [
        {"role": "user", "content": "Tell me a story"}
    ],
    "stream": true
}'
```

---
