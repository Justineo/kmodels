# StartAsyncInvoke

<a name="API_runtime_StartAsyncInvoke"></a>

Starts an asynchronous invocation.

This operation requires permission for the `bedrock:InvokeModel` action.

**Important**  
To deny all inference access to resources that you specify in the modelId field, you need to deny access to the `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` actions. Doing this also denies access to the resource through the Converse API actions ([Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) and [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)). For more information see [Deny access for inference on specific models](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html#security_iam_id-based-policy-examples-deny-inference).

## Request Syntax

<a name="API_runtime_StartAsyncInvoke_RequestSyntax"></a>

```
POST /async-invoke HTTP/1.1
Content-type: application/json

{
   "clientRequestToken": "{{string}}",
   "modelId": "{{string}}",
   "modelInput": {{JSON value}},
   "outputDataConfig": { ... },
   "tags": [
      {
         "key": "{{string}}",
         "value": "{{string}}"
      }
   ]
}
```

## URI Request Parameters

<a name="API_runtime_StartAsyncInvoke_RequestParameters"></a>

The request does not use any URI parameters.

## Request Body

<a name="API_runtime_StartAsyncInvoke_RequestBody"></a>

The request accepts the following data in JSON format.

** [clientRequestToken](#API_runtime_StartAsyncInvoke_RequestSyntax) ** <a name="bedrock-runtime_StartAsyncInvoke-request-clientRequestToken"></a>
Specify idempotency token to ensure that requests are not duplicated.  
Type: String  
Length Constraints: Minimum length of 1. Maximum length of 256.  
Pattern: `[!-~]*`  
Required: No

** [modelId](#API_runtime_StartAsyncInvoke_RequestSyntax) ** <a name="bedrock-runtime_StartAsyncInvoke-request-modelId"></a>
The model to invoke.  
Type: String  
Length Constraints: Minimum length of 1. Maximum length of 256.  
Pattern: `[a-zA-Z_\.\-/0-9:]+`  
Required: Yes

** [modelInput](#API_runtime_StartAsyncInvoke_RequestSyntax) ** <a name="bedrock-runtime_StartAsyncInvoke-request-modelInput"></a>
Input to send to the model.  
Type: JSON value  
Required: Yes

** [outputDataConfig](#API_runtime_StartAsyncInvoke_RequestSyntax) ** <a name="bedrock-runtime_StartAsyncInvoke-request-outputDataConfig"></a>
Where to store the output.  
Type: [AsyncInvokeOutputDataConfig](API_runtime_AsyncInvokeOutputDataConfig.md) object  
**Note: **This object is a Union. Only one member of this object can be specified or returned.  
Required: Yes

** [tags](#API_runtime_StartAsyncInvoke_RequestSyntax) ** <a name="bedrock-runtime_StartAsyncInvoke-request-tags"></a>
Tags to apply to the invocation.  
Type: Array of [Tag](API_runtime_Tag.md) objects  
Array Members: Minimum number of 0 items. Maximum number of 200 items.  
Required: No
