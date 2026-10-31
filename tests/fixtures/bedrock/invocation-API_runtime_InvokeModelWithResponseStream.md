# InvokeModelWithResponseStream

<a name="API_runtime_InvokeModelWithResponseStream"></a>

Invoke the specified Amazon Bedrock model to run inference using the prompt and inference parameters provided in the request body. The response is returned in a stream.

To see if a model supports streaming, call [GetFoundationModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetFoundationModel.html) and check the `responseStreamingSupported` field in the response.

**Note**  
The AWS CLI doesn't support streaming operations in Amazon Bedrock, including `InvokeModelWithResponseStream`.

For example code, see [Invoke model with streaming code example](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-invoke.html#inference-examples-stream).

This operation requires permissions to perform the `bedrock:InvokeModelWithResponseStream` action.

**Important**  
To deny all inference access to resources that you specify in the modelId field, you need to deny access to the `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` actions. Doing this also denies access to the resource through the Converse API actions ([Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) and [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)). For more information see [Deny access for inference on specific models](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html#security_iam_id-based-policy-examples-deny-inference).

For troubleshooting some of the common errors you might encounter when using the `InvokeModelWithResponseStream` API, see [Troubleshooting Amazon Bedrock API Error Codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html) in the Amazon Bedrock User Guide

## Request Syntax

<a name="API_runtime_InvokeModelWithResponseStream_RequestSyntax"></a>

```
POST /model/{{modelId}}/invoke-with-response-stream HTTP/1.1
Content-Type: {{contentType}}
X-Amzn-Bedrock-Accept: {{accept}}
X-Amzn-Bedrock-Trace: {{trace}}
X-Amzn-Bedrock-GuardrailIdentifier: {{guardrailIdentifier}}
X-Amzn-Bedrock-GuardrailVersion: {{guardrailVersion}}
X-Amzn-Bedrock-PerformanceConfig-Latency: {{performanceConfigLatency}}
X-Amzn-Bedrock-Service-Tier: {{serviceTier}}
X-Amzn-Bedrock-Request-Metadata: {{requestMetadata}}

{{body}}
```

## URI Request Parameters

<a name="API_runtime_InvokeModelWithResponseStream_RequestParameters"></a>

The request uses the following URI parameters.

** [accept](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-accept"></a>
The desired MIME type of the inference body in the response. The default value is `application/json`.

** [contentType](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-contentType"></a>
The MIME type of the input data in the request. You must specify `application/json`.

** [guardrailIdentifier](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-guardrailIdentifier"></a>
The unique identifier of the guardrail that you want to use. If you don't provide a value, no guardrail is applied to the invocation.  
An error is thrown in the following situations.

- You don't provide a guardrail identifier but you specify the `amazon-bedrock-guardrailConfig` field in the request body.
- You enable the guardrail but the `contentType` isn't `application/json`.
- You provide a guardrail identifier, but `guardrailVersion` isn't specified.
  Length Constraints: Minimum length of 0. Maximum length of 2048.  
  Pattern: `(|([a-z0-9]+)|(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:[0-9]{12}:guardrail/[a-z0-9]+))`

** [guardrailVersion](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-guardrailVersion"></a>
The version number for the guardrail. The value can also be `DRAFT`.  
Pattern: `(|([1-9][0-9]{0,7})|(DRAFT))`

** [modelId](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-uri-modelId"></a>
Specifies the model or throughput with which to run inference, or the prompt resource to use in inference. The value depends on the resource that you use:

- If you use a base model, specify the model ID or its ARN. For a list of model IDs for base models, see [Amazon Bedrock base model IDs (on-demand throughput)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html) in the Amazon Bedrock User Guide.
- If you use an Amazon Bedrock Marketplace model, specify the ID or ARN of the marketplace endpoint that you created. For more information about Amazon Bedrock Marketplace and setting up an endpoint, see [Amazon Bedrock Marketplace](https://docs.aws.amazon.com/bedrock/latest/userguide/amazon-bedrock-marketplace.html) in the Amazon Bedrock User Guide.
- If you use an inference profile, specify the inference profile ID or its ARN. For a list of inference profile IDs, see [Supported Regions and models for cross-region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference-support.html) in the Amazon Bedrock User Guide.
- If you use a prompt created through [Prompt management](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management.html), specify the ARN of the prompt version. For more information, see [Test a prompt using Prompt management](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management-test.html).
- If you use a provisioned model, specify the ARN of the Provisioned Throughput. For more information, see [Run inference using a Provisioned Throughput](https://docs.aws.amazon.com/bedrock/latest/userguide/prov-thru-use.html) in the Amazon Bedrock User Guide.
- If you use a custom model, specify the ARN of the custom model deployment (for on-demand inference) or the ARN of your provisioned model (for Provisioned Throughput). For more information, see [Use a custom model in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-use.html) in the Amazon Bedrock User Guide.
- If you use an [imported model](https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-import-model.html), specify the ARN of the imported model. You can get the model ARN from a successful call to [CreateModelImportJob](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_CreateModelImportJob.html) or from the Imported models page in the Amazon Bedrock console.
  Length Constraints: Minimum length of 1. Maximum length of 2048.  
  Pattern: `(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:(([0-9]{12}:custom-model/[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}/[a-z0-9]{12})|(:foundation-model/[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|([0-9]{12}:imported-model/[a-z0-9]{12})|([0-9]{12}:provisioned-model/[a-z0-9]{12})|([0-9]{12}:custom-model-deployment/[a-z0-9]{12})|([0-9]{12}:(inference-profile|application-inference-profile)/[a-zA-Z0-9-:.]+)))|([a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|(([0-9a-zA-Z][_-]?)+)|([a-zA-Z0-9-:.]+)$|(^(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:[0-9]{12}:prompt/[0-9a-zA-Z]{10}(?::[0-9]{1,5})?))$|(^arn:aws:sagemaker:[a-z0-9-]+:[0-9]{12}:endpoint/[a-zA-Z0-9-]+$)|(^arn:aws(-[^:]+)?:bedrock:([0-9a-z-]{1,20}):([0-9]{12}):(default-)?prompt-router/[a-zA-Z0-9-:.]+$)`  
  Required: Yes

** [performanceConfigLatency](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-performanceConfigLatency"></a>
Model performance settings for the request.  
Valid Values: `standard | optimized`

** [requestMetadata](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-requestMetadata"></a>
Key-value pairs that you can use to filter invocation logs.  
Length Constraints: Minimum length of 0. Maximum length of 8500.

** [serviceTier](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-serviceTier"></a>
Specifies the processing tier type used for serving the request.  
Valid Values: `priority | default | flex | reserved`

** [trace](#API_runtime_InvokeModelWithResponseStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithResponseStream-request-trace"></a>
Specifies whether to enable or disable the Bedrock trace. If enabled, you can see the full Bedrock trace.  
Valid Values: `ENABLED | DISABLED | ENABLED_FULL`
