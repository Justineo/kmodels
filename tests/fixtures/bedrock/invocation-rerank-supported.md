# Supported Regions and models for reranking in Amazon Bedrock

<a name="rerank-supported"></a>

The following list provides links to general information about Regional and model support in Amazon Bedrock:

- For a list of Region codes and endpoints supported in Amazon Bedrock, see [Amazon Bedrock endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html#bedrock_region).
- For a list of Amazon Bedrock model IDs to use when calling Amazon Bedrock API operations, see [Supported foundation models in Amazon Bedrock](models-supported.md).

The following table shows the reranker models you can use and the Regions in which they are supported:

**Note**  
The Amazon Rerank 1.0 model is not supported in the US East (N. Virginia) AWS Region. You can only use the Cohere Rerank 3.5 model in this Region.

The following table shows model support for reranking:

| Provider | Model      | Model ID             | Single-region model support                                                      |
| -------- | ---------- | -------------------- | -------------------------------------------------------------------------------- |
| Amazon   | Rerank 1.0 | amazon.rerank-v1:0   | ap-northeast-1<br />ca-central-1<br />eu-central-1<br />us-west-2                |
| Cohere   | Rerank 3.5 | cohere.rerank-v3-5:0 | ap-northeast-1<br />ca-central-1<br />eu-central-1<br />us-east-1<br />us-west-2 |

For more information about reranking with Cohere models and their inference parameters, see [Rerank](https://docs.cohere.com/reference/rerank) on the Cohere documentation website.
