## Request Syntax

<a name="API_runtime_Converse_RequestSyntax"></a>

```
POST /model/{{modelId}}/converse HTTP/1.1
Content-type: application/json

{
   "additionalModelRequestFields": {{JSON value}},
   "additionalModelResponseFieldPaths": [ "{{string}}" ],
   "guardrailConfig": {
      "guardrailIdentifier": "{{string}}",
      "guardrailVersion": "{{string}}",
      "trace": "{{string}}"
   },
   "inferenceConfig": {
      "maxTokens": {{number}},
      "stopSequences": [ "{{string}}" ],
      "temperature": {{number}},
      "topP": {{number}}
   },
   "messages": [
      {
         "content": [
            { ... }
         ],
         "role": "{{string}}"
      }
   ],
   "outputConfig": {
      "textFormat": {
         "structure": { ... },
         "type": "{{string}}"
      }
   },
   "performanceConfig": {
      "latency": "{{string}}"
   },
   "promptVariables": {
      "{{string}}" : { ... }
   },
   "requestMetadata": {
      "{{string}}" : "{{string}}"
   },
   "serviceTier": {
      "type": "{{string}}"
   },
   "system": [
      { ... }
   ],
   "toolConfig": {
      "toolChoice": { ... },
      "tools": [
         { ... }
      ]
   }
}
```

## URI Request Parameters

<a name="API_runtime_Converse_RequestParameters"></a>

The request uses the following URI parameters.

** [modelId](#API_runtime_Converse_RequestSyntax) ** <a name="bedrock-runtime_Converse-request-uri-modelId"></a>
Specifies the model or throughput with which to run inference, or the prompt resource to use in inference. The value depends on the resource that you use:

- If you use a base model, specify the model ID or its ARN. For a list of model IDs for base models, see [Amazon Bedrock base model IDs (on-demand throughput)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html) in the Amazon Bedrock User Guide.
- If you use an Amazon Bedrock Marketplace model, specify the ID or ARN of the marketplace endpoint that you created. For more information about Amazon Bedrock Marketplace and setting up an endpoint, see [Amazon Bedrock Marketplace](https://docs.aws.amazon.com/bedrock/latest/userguide/amazon-bedrock-marketplace.html) in the Amazon Bedrock User Guide.
- If you use an inference profile, specify the inference profile ID or its ARN. For a list of inference profile IDs, see [Supported Regions and models for cross-region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference-support.html) in the Amazon Bedrock User Guide.
- If you use a prompt created through [Prompt management](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management.html), specify the ARN of the prompt version. For more information, see [Test a prompt using Prompt management](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management-test.html).
- If you use a provisioned model, specify the ARN of the Provisioned Throughput. For more information, see [Run inference using a Provisioned Throughput](https://docs.aws.amazon.com/bedrock/latest/userguide/prov-thru-use.html) in the Amazon Bedrock User Guide.
- If you use a custom model, specify the ARN of the custom model deployment (for on-demand inference) or the ARN of your provisioned model (for Provisioned Throughput). For more information, see [Use a custom model in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-use.html) in the Amazon Bedrock User Guide.
  Length Constraints: Minimum length of 1. Maximum length of 2048.  
  Pattern: `(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:(([0-9]{12}:custom-model/[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}/[a-z0-9]{12})|(:foundation-model/[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|([0-9]{12}:imported-model/[a-z0-9]{12})|([0-9]{12}:provisioned-model/[a-z0-9]{12})|([0-9]{12}:custom-model-deployment/[a-z0-9]{12})|([0-9]{12}:(inference-profile|application-inference-profile)/[a-zA-Z0-9-:.]+)))|([a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|(([0-9a-zA-Z][_-]?)+)|([a-zA-Z0-9-:.]+)|(^(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:[0-9]{12}:prompt/[0-9a-zA-Z]{10}(?::[0-9]{1,5})?))$|(^arn:aws:sagemaker:[a-z0-9-]+:[0-9]{12}:endpoint/[a-zA-Z0-9-]+$)|(^arn:aws(-[^:]+)?:bedrock:([0-9a-z-]{1,20}):([0-9]{12}):(default-)?prompt-router/[a-zA-Z0-9-:.]+$)`  
  Required: Yes
