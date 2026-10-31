# Rerank

<a name="API_agent-runtime_Rerank"></a>

Reranks the relevance of sources based on queries. For more information, see [Improve the relevance of query responses with a reranker model](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank.html).

## Request Syntax

<a name="API_agent-runtime_Rerank_RequestSyntax"></a>

```
POST /rerank HTTP/1.1
Content-type: application/json

{
   "nextToken": "{{string}}",
   "queries": [
      {
         "textQuery": {
            "text": "{{string}}"
         },
         "type": "{{string}}"
      }
   ],
   "rerankingConfiguration": {
      "bedrockRerankingConfiguration": {
         "modelConfiguration": {
            "additionalModelRequestFields": {
               "{{string}}" : {{JSON value}}
            },
            "modelArn": "{{string}}"
         },
         "numberOfResults": {{number}}
      },
      "type": "{{string}}"
   },
   "sources": [
      {
         "inlineDocumentSource": {
            "jsonDocument": {{JSON value}},
            "textDocument": {
               "text": "{{string}}"
            },
            "type": "{{string}}"
         },
         "type": "{{string}}"
      }
   ]
}
```

## URI Request Parameters

<a name="API_agent-runtime_Rerank_RequestParameters"></a>

The request does not use any URI parameters.

## Request Body

<a name="API_agent-runtime_Rerank_RequestBody"></a>

The request accepts the following data in JSON format.

** [nextToken](#API_agent-runtime_Rerank_RequestSyntax) ** <a name="bedrock-agent-runtime_Rerank-request-nextToken"></a>
If the total number of results was greater than could fit in a response, a token is returned in the `nextToken` field. You can enter that token in this field to return the next batch of results.  
Type: String  
Length Constraints: Minimum length of 1. Maximum length of 2048.  
Pattern: `\S*`  
Required: No

** [queries](#API_agent-runtime_Rerank_RequestSyntax) ** <a name="bedrock-agent-runtime_Rerank-request-queries"></a>
An array of objects, each of which contains information about a query to submit to the reranker model.  
Type: Array of [RerankQuery](API_agent-runtime_RerankQuery.md) objects  
Array Members: Fixed number of 1 item.  
Required: Yes

** [rerankingConfiguration](#API_agent-runtime_Rerank_RequestSyntax) ** <a name="bedrock-agent-runtime_Rerank-request-rerankingConfiguration"></a>
Contains configurations for reranking.  
Type: [RerankingConfiguration](API_agent-runtime_RerankingConfiguration.md) object  
Required: Yes

** [sources](#API_agent-runtime_Rerank_RequestSyntax) ** <a name="bedrock-agent-runtime_Rerank-request-sources"></a>
An array of objects, each of which contains information about the sources to rerank.  
Type: Array of [RerankSource](API_agent-runtime_RerankSource.md) objects  
Array Members: Minimum number of 1 item. Maximum number of 1000 items.  
Required: Yes
