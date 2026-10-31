# BedrockRerankingModelConfiguration

<a name="API_agent-runtime_BedrockRerankingModelConfiguration"></a>

Contains configurations for a reranker model.

## Contents

<a name="API_agent-runtime_BedrockRerankingModelConfiguration_Contents"></a>

** modelArn ** <a name="bedrock-Type-agent-runtime_BedrockRerankingModelConfiguration-modelArn"></a>
The ARN of the reranker model.  
Type: String  
Length Constraints: Minimum length of 1. Maximum length of 2048.  
Pattern: `(arn:aws(-[^:]+)?:(bedrock|sagemaker):[a-z0-9-]{1,20}:([0-9]{12})?:([a-z-]+/)?)?([a-z0-9.-]{1,63}){0,2}(([:][a-z0-9-]{1,63}){0,2})?(/[a-z0-9]{1,12})?`  
Required: Yes

** additionalModelRequestFields ** <a name="bedrock-Type-agent-runtime_BedrockRerankingModelConfiguration-additionalModelRequestFields"></a>
A JSON object whose keys are request fields for the model and whose values are values for those fields.  
Type: String to JSON value map  
Key Length Constraints: Minimum length of 1. Maximum length of 100.  
Required: No

## See Also

<a name="API_agent-runtime_BedrockRerankingModelConfiguration_SeeAlso"></a>

For more information about using this API in one of the language-specific AWS SDKs, see the following:

- [AWS SDK for C\+\+](https://docs.aws.amazon.com/goto/SdkForCpp/bedrock-agent-runtime-2023-07-26/BedrockRerankingModelConfiguration)
- [AWS SDK for Java V2](https://docs.aws.amazon.com/goto/SdkForJavaV2/bedrock-agent-runtime-2023-07-26/BedrockRerankingModelConfiguration)
- [AWS SDK for Ruby V3](https://docs.aws.amazon.com/goto/SdkForRubyV3/bedrock-agent-runtime-2023-07-26/BedrockRerankingModelConfiguration)
