# InvokeModelWithBidirectionalStream

<a name="API_runtime_InvokeModelWithBidirectionalStream"></a>

Invoke the specified Amazon Bedrock model to run inference using the bidirectional stream. The response is returned in a stream that remains open for 8 minutes. A single session can contain multiple prompts and responses from the model. The prompts to the model are provided as audio files and the model's responses are spoken back to the user and transcribed.

It is possible for users to interrupt the model's response with a new prompt, which will halt the response speech. The model will retain contextual awareness of the conversation while pivoting to respond to the new prompt.

This operation requires permission for the `bedrock:InvokeModel` action.

Note that to log `InvokeModelWithBidirectionalStream` API calls in CloudTrail, you need to configure advanced event selectors to record data events for the `AWS::Bedrock::Model` resource type and `AWS:Bedrock::AsyncInvoke`. To learn more, see [Monitor Amazon Bedrock API calls using CloudTrail](https://docs.aws.amazon.com/bedrock/latest/userguide/logging-using-cloudtrail.html).

**Important**  
To deny all inference access to resources that you specify in the modelId field, you need to deny access to the `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` actions. Doing this also denies access to the resource through the Converse API actions ([Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) and [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)). For more information see [Deny access for inference on specific models](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html#security_iam_id-based-policy-examples-deny-inference).

For more information, see [Using the Amazon Nova Sonic Speech-to-Speech model](https://docs.aws.amazon.com/nova/latest/userguide/speech.html).

## Request Syntax

<a name="API_runtime_InvokeModelWithBidirectionalStream_RequestSyntax"></a>

```
POST /model/{{modelId}}/invoke-with-bidirectional-stream HTTP/1.1
Content-type: application/json

{
   "chunk": {
      "bytes": {{blob}}
   }
}
```

## URI Request Parameters

<a name="API_runtime_InvokeModelWithBidirectionalStream_RequestParameters"></a>

The request uses the following URI parameters.

** [modelId](#API_runtime_InvokeModelWithBidirectionalStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithBidirectionalStream-request-uri-modelId"></a>
The model ID or ARN of the model ID to use. Currently, only `amazon.nova-sonic-v1:0` is supported.  
Length Constraints: Minimum length of 1. Maximum length of 2048.  
Pattern: `(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:(([0-9]{12}:custom-model/[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}/[a-z0-9]{12})|(:foundation-model/[a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|([0-9]{12}:imported-model/[a-z0-9]{12})|([0-9]{12}:provisioned-model/[a-z0-9]{12})|([0-9]{12}:custom-model-deployment/[a-z0-9]{12})|([0-9]{12}:(inference-profile|application-inference-profile)/[a-zA-Z0-9-:.]+)))|([a-z0-9-]{1,63}[.]{1}[a-z0-9-]{1,63}([.:]?[a-z0-9-]{1,63}))|(([0-9a-zA-Z][_-]?)+)|([a-zA-Z0-9-:.]+)$|(^(arn:aws(-[^:]+)?:bedrock:[a-z0-9-]{1,20}:[0-9]{12}:prompt/[0-9a-zA-Z]{10}(?::[0-9]{1,5})?))$|(^arn:aws:sagemaker:[a-z0-9-]+:[0-9]{12}:endpoint/[a-zA-Z0-9-]+$)|(^arn:aws(-[^:]+)?:bedrock:([0-9a-z-]{1,20}):([0-9]{12}):(default-)?prompt-router/[a-zA-Z0-9-:.]+$)`  
Required: Yes

## Request Body

<a name="API_runtime_InvokeModelWithBidirectionalStream_RequestBody"></a>

The request accepts the following data in JSON format.

** [chunk](#API_runtime_InvokeModelWithBidirectionalStream_RequestSyntax) ** <a name="bedrock-runtime_InvokeModelWithBidirectionalStream-request-chunk"></a>
The audio chunk that is used as input for the invocation step.  
Type: [BidirectionalInputPayloadPart](API_runtime_BidirectionalInputPayloadPart.md) object  
Required: No
