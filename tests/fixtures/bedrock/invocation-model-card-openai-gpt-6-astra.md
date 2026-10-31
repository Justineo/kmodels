# GPT-6 Astra

<a name="model-card-openai-gpt-6-astra"></a>

## Model Details

<a name="model-card-openai-gpt-6-astra-details"></a>

GPT-6 Astra is OpenAI's most capable model. It handles the hardest end-to-end work. Use it for complex reasoning, coding, computer use, research, and document creation. To learn more, see the [OpenAI Deployment Safety Hub](https://deploymentsafety.openai.com/gpt-6-astra/).

- **Model launch date:** September 8, 2026
- **EOL no sooner than:** September 8, 2027
- **Legacy period:** at least 6 months
- **Model lifecycle policy:** [Model lifecycle](model-lifecycle.md)
- **Model EOL date:** N/A
- **End User License Agreements and Terms of Use:** [View](https://aws.amazon.com/legal/bedrock/third-party-models/)
- **Model lifecycle:** Active
- **Context window:** 1,050,000 tokens
- **Max output tokens:** 128,000
- **Knowledge cutoff:** April 30, 2026
- **Marketplace product ID:** `prod-hqau7gqhlqsrg`

| **Input Modalities**                                                                                   | **Output Modalities**                                                                                     |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Audio  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Embedding |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Image     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Image     |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Speech    |
| ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text      | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Text         |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) Video     |

## Endpoints and APIs supported

<a name="model-card-openai-gpt-6-astra-apis-endpoints"></a>

The following tables show which endpoints and APIs GPT-6 Astra supports. For more information, see [APIs supported by Amazon Bedrock](apis.md) and [Inference endpoints supported by Amazon Bedrock](endpoints.md).

**Endpoint support**

| **Endpoint**    | **Supported**                                                                                |
| --------------- | -------------------------------------------------------------------------------------------- |
| bedrock-runtime | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| bedrock-mantle  | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |

**APIs supported on `bedrock-runtime`**

| **Messages**                                                                                    | **Responses**                                                                                | **Chat Completions**                                                                         | **Converse**                                                                                 | **Invoke**                                                                                   |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |

**APIs supported on `bedrock-mantle`**

| **Messages**                                                                                    | **Responses**                                                                                | **Chat Completions**                                                                         | **Converse**                                                                                    | **Invoke**                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

**Note**  
On `bedrock-mantle`, both APIs use the `/openai/v1` base path, not `/v1`. Use either API with this model:  
For Responses, use `/openai/v1/responses`.
For Chat Completions, use `/openai/v1/chat/completions`.

## Capabilities and Features

<a name="model-card-openai-gpt-6-astra-capabilities"></a>

_**Bedrock Features**_

**Features supported using `bedrock-runtime`**

| **Supported**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Not Supported**                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| + ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Projects (default project only)](projects.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Invocation logs](model-invocation-logging.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Response streaming](/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Abuse detection](abuse-detection.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Guardrails](guardrails.html) ([Converse API](conversation-inference.html) only)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Application inference profiles](cost-mgmt-application-inference-profiles.html) (InvokeModel and [Converse](conversation-inference.html) APIs only; not supported with Responses or Chat Completions)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Implicit Prompt Caching](prompt-caching.html#prompt-caching-implicit) (Responses, Chat Completions, InvokeModel, and Converse APIs)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Explicit Prompt Caching](prompt-caching.html#prompt-caching-explicit) (Responses, Chat Completions, and InvokeModel APIs; not supported with Converse)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Structured outputs (JSON Schema; see API configuration)](#model-card-openai-gpt-6-astra-structured-output)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Reasoning Summaries](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries) (Responses, [Converse](conversation-inference.html), and ConverseStream APIs; on Converse, set `additionalModelRequestFields.reasoning.summary`) | + ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Server-side tool use](tool-use.html)<br />+ ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Intelligent prompt routing](prompt-routing.html)<br />+ ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Count tokens](count-tokens.html) |

**Features supported using `bedrock-mantle`**

| **Supported**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Not Supported**                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| + ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Server-side tool calling](tool-use.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Projects](projects.html)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Implicit Prompt Caching](prompt-caching.html#prompt-caching-implicit) (Responses and Chat Completions APIs)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Explicit Prompt Caching](prompt-caching.html#prompt-caching-explicit) (Responses and Chat Completions APIs)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Reasoning Summaries](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries) (Responses API only)<br />+ ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Structured outputs](structured-output.html) (JSON Schema; Responses and Chat Completions APIs) | + ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Application inference profiles](cost-mgmt-application-inference-profiles.html) |

### JSON Schema output on bedrock-runtime

<a name="model-card-openai-gpt-6-astra-structured-output"></a>

Use JSON Schema to set the format of the model response. These settings apply to non-streaming calls on the `bedrock-runtime` endpoint. Choose a profile ID from [Programmatic access](#model-card-openai-gpt-6-astra-programmatic-access).

- For Chat Completions, set `response_format.type` to `json_schema`. Put `name`, `schema`, and `strict: true` in `response_format.json_schema`.
- For Responses, set `text.format.type` to `json_schema`. Put `name`, `schema`, and `strict: true` in `text.format`.
- For Converse, set `outputConfig.textFormat.type` to `json_schema`. In `outputConfig.textFormat.structure.jsonSchema`, set `name` and `schema`. Encode the schema as a JSON string. Then set `additionalModelRequestFields.text.format.strict` to `true`.

Use an object schema. Put all fields in `required`. Set `additionalProperties` to `false`. Validate your schema before you send it. Check for refusals or incomplete responses before you parse the output.

**Important**  
For JSON Schema output with the Converse API, you must set `additionalModelRequestFields.text.format.strict` to `true`, in addition to specifying the schema in `outputConfig`. Include the following field in your request.

```
{
  "additionalModelRequestFields": {
    "text": {
      "format": { "strict": true }
    }
  }
}
```

**Converse content blocks**

On the `bedrock-runtime` endpoint, Converse accepts `text` and `image` content blocks in user messages. This model doesn't accept `document` content blocks, and it doesn't accept an `image` content block inside a `toolResult`. A request that includes either is rejected with a `ValidationException`. To send a document to this model, use the Responses API with an `input_file` content part instead.

## Programmatic Access

<a name="model-card-openai-gpt-6-astra-programmatic-access"></a>

To call this model from code, use the following model IDs and endpoint URLs. For more information, see [APIs supported by Amazon Bedrock](apis.md) and [Inference endpoints supported by Amazon Bedrock](endpoints.md).

| **Endpoint**    | **Model ID**       | **In-Region endpoint URL**                                                                                                     | **Geo inference ID**  | **Global inference ID**   |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------- |
| bedrock-mantle  | openai.gpt-6-astra | `https://bedrock-mantle.us-east-1.api.aws/openai/v1`<br />`https://bedrock-mantle.us-west-2.api.aws/openai/v1` (Standard only) | Not supported         | Not supported             |
| bedrock-runtime | openai.gpt-6-astra | Not supported                                                                                                                  | us.openai.gpt-6-astra | global.openai.gpt-6-astra |

_The `bedrock-mantle` endpoint is available in `us-east-1` (N. Virginia) and `us-west-2` (Oregon). Ultrafast is available only in `us-east-1` on this endpoint. On `bedrock-runtime`, the base URL is `https://bedrock-runtime.{region}.amazonaws.com/openai/v1`. Name `us.openai.gpt-6-astra` for US geographic cross-Region inference or `global.openai.gpt-6-astra` for global cross-Region inference._

## Regional Availability

<a name="model-card-openai-gpt-6-astra-regional-availability"></a>

_**Regional availability at a glance**_

Amazon Bedrock offers three inference options. **In-Region** keeps requests in one Region for strict compliance. **Geo Cross-Region** routes requests across Regions in one geography. It respects data residency. **Global Cross-Region** routes requests anywhere in the world. Use it when you have no data residency needs. For more information, see the [Regional availability by models](models-region-compatibility.md) page.

**Availability using the `bedrock-mantle` endpoint**

| **Region**              | **In-Region**                                                                                | **Geo**                                                                                         | **Global**                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |
| us-west-2 (Oregon)      | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) |

Ultrafast is available through regional Mantle in `us-east-1`. Regional Mantle in `us-west-2` supports Standard only.

**Availability using the `bedrock-runtime` endpoint**

| **Region**                 | **In-Region**                                                                                   | **Geo**                                                                                         | **Global**                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia)    | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| us-east-2 (Ohio)           | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| us-west-1 (N. California)  | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| us-west-2 (Oregon)         | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ca-central-1 (Canada)      | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ca-west-1 (Calgary)        | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)    | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-central-1 (Frankfurt)   | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-north-1 (Stockholm)     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-west-1 (Ireland)        | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-west-2 (London)         | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| eu-west-3 (Paris)          | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-northeast-1 (Tokyo)     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-northeast-2 (Seoul)     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-northeast-3 (Osaka)     | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-south-1 (Mumbai)        | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-1 (Singapore) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| ap-southeast-2 (Sydney)    | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |
| sa-east-1 (São Paulo)      | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![not-supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) | ![supported](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) |

_**Geo inference details**_

The destination Regions available to a geographic inference profile depend on the source Region. To retrieve the current routing configuration, call [GetInferenceProfile](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetInferenceProfile.html) from the source Region.

**Geo: US**

Geo inference ID: `us.openai.gpt-6-astra`

| **Source Region**         | **Destination Regions**                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| us-east-1 (N. Virginia)   | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| us-east-2 (Ohio)          | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| us-west-1 (N. California) | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-1 (N. California), us-west-2 (Oregon) |
| us-west-2 (Oregon)        | us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)                            |
| ca-central-1 (Canada)     | ca-central-1 (Canada), us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)     |
| ca-west-1 (Calgary)       | ca-west-1 (Calgary), us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon)       |
