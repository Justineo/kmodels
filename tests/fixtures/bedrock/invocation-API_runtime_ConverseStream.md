# ConverseStream

<a name="API_runtime_ConverseStream"></a>

Sends messages to the specified Amazon Bedrock model and returns the response in a stream. `ConverseStream` provides a consistent API that works with all Amazon Bedrock models that support messages. This allows you to write code once and use it with different models. Should a model have unique inference parameters, you can also pass those unique parameters to the model.

To find out if a model supports streaming, call [GetFoundationModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetFoundationModel.html) and check the `responseStreamingSupported` field in the response.

**Note**  
The AWS CLI doesn't support streaming operations in Amazon Bedrock, including `ConverseStream`.

Amazon Bedrock doesn't store any text, images, or documents that you provide as content. The data is only used to generate the response.

You can submit a prompt by including it in the `messages` field, specifying the `modelId` of a foundation model or inference profile to run inference on it, and including any other fields that are relevant to your use case.

You can also submit a prompt from Prompt management by specifying the ARN of the prompt version and including a map of variables to values in the `promptVariables` field. You can append more messages to the prompt by using the `messages` field. If you use a prompt from Prompt management, you can't include the following fields in the request: `additionalModelRequestFields`, `inferenceConfig`, `system`, or `toolConfig`. Instead, these fields must be defined through Prompt management. For more information, see [Test a prompt using Prompt management](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management-test.html).

For information about the Converse API, see [Use the Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html). To use a guardrail, see [Use a guardrail with the Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-converse-api.html). To use a tool with a model, see [Tool use (Function calling)](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html).

For example code, see [Conversation streaming example](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html#messages-streaming-inference-example).

This operation requires permission for the `bedrock:InvokeModelWithResponseStream` action.

**Important**  
To deny all inference access to resources that you specify in the modelId field, you need to deny access to the `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` actions. Doing this also denies access to the resource through the base inference actions ([InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html) and [InvokeModelWithResponseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html)). For more information see [Deny access for inference on specific models](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html#security_iam_id-based-policy-examples-deny-inference).

For troubleshooting some of the common errors you might encounter when using the `ConverseStream` API, see [Troubleshooting Amazon Bedrock API Error Codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html) in the Amazon Bedrock User Guide

## Request Syntax

<a name="API_runtime_ConverseStream_RequestSyntax"></a>

```
POST /model/{{modelId}}/converse-stream HTTP/1.1
Content-type: application/json

{
   "additionalModelRequestFields": {{JSON value}},
   "additionalModelResponseFieldPaths": [ "{{string}}" ],
   "guardrailConfig": {
      "guardrailIdentifier": "{{string}}",
      "guardrailVersion": "{{string}}",
      "streamProcessingMode": "{{string}}",
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

<a name="API_runtime_ConverseStream_RequestParameters"></a>

The request uses the following URI parameters.

** [modelId](#API_runtime_ConverseStream_RequestSyntax) ** <a name="bedrock-runtime_ConverseStream-request-uri-modelId"></a>
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
