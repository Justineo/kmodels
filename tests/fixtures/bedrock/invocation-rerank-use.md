# Use a reranker model in Amazon Bedrock

<a name="rerank-use"></a>

You can use a reranker model directly or while retrieving results during knowledge base query. Choose the tab for your preferred method, and then follow the steps:

---

#### [ Console ]

You can't use a reranker model directly in the AWS Management Console, but you can use a reranker model when querying your knowledge base by doing the following:

1. When you query a knowledge base, open up the **Configurations** pane by choosing the ![Icon showing three horizontal sliders at different positions for adjusting settings.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/configurations.png) icon.

1. Expand the **Reranking** section.

1. Choose **Select model** and select a reranker model.

1. If your Amazon Bedrock Knowledge Bases service role is missing [permissions to use the reranker model](rerank-prereq.md), select **Update service role** to modify the role with the proper permissions.

1. (Optional) In the **Additional Reranking options** section, modify any options that you need to.

1. Enter a prompt and select **Run**. The response is the result after applying the reranker model.

For more detailed instructions about carrying out knowledge base query, see [Query a knowledge base and retrieve data](kb-test-retrieve.md) and [Query a knowledge base and generate responses based off the retrieved data](kb-test-retrieve-generate.md).

---

#### [ API ]

For instructions on using a reranker model during knowledge base query, see [Query a knowledge base and retrieve data](kb-test-retrieve.md) and [Query a knowledge base and generate responses based off the retrieved data](kb-test-retrieve-generate.md).

To use a reranker model directly with the Amazon Bedrock API, send a [Rerank](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_Rerank.html) request with an [Agents for Amazon Bedrock runtime endpoint](https://docs.aws.amazon.com/general/latest/gr/bedrock.html#bra-rt).

The following fields are required:

| Field                  | Basic description                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queries                | An array of one [RerankQuery](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RerankQuery.html) object. Specify TEXT as the type and include the query in the textQuery field.                                                                                                                                                                                                                                |
| sources                | An array of [RerankSource](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RerankSource.html) objects to submit to the reranking model. For each RerankSource, specify INLINE as the type and include a [RerankDocument](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RerankDocument.html) object in the inlineDocumentSource field. See below for details about RerankDocument. |
| rerankingConfiguration | Includes the Amazon Resource Name (ARN) of the reranking model to use, and the number of results to return after reranking, and, optionally, inference configurations for the model. You specify additional model configurations as key-value pairs. For more information, see [Rerank](https://docs.cohere.com/reference/rerank) on the Cohere documentation website.                                                                  |

The following fields are optional:

| Field     | Use case                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------- |
| nextToken | A token returned in a previous response that you can include to provide the next batch of results. |

The format of the `RerankSource` object that you include depends on the format of the document. To see the format for different `RerankSource` types, choose the tab that corresponds to the format of the document:

---

#### [ String ]

If the document is a string, then specify the value of the `type` field of the [RerankDocument](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RerankDocument.html) object as `TEXT` and include the document in the `text` field. For example:

```
{
    "inlineDocumentSource": {
        "textDocument": {
            "text": "string"
        },
        "type": "TEXT"
    },
    "type": "INLINE"
}
```

---

#### [ JSON object ]

If the document is a JSON object, then specify the value of the `type` field in the [RerankDocument](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RerankDocument.html) object as `JSON` and include the document in the `jsonDocument` field. For example:

```
{
    "inlineDocumentSource": {
        "jsonDocument": JSON value,
        "type": "JSON"
    },
    "type": "INLINE"
}
```

---

The response to your `Rerank` request returns a list of [RerankResult](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RerankResult.html) objects in the `results` field. Each object contains the following fields:

- `document` – Includes information about the document that you submitted.
- `relevanceScore` – A relevance score for the document, assigned by the reranking model.
- `index` – The zero-based index of the document in the `sources` array in the request.

If there are too many results to display, then the response returns a value in the `nextToken` field. In this case, to see the next batch of results, include that token in a subsequent request.

**Code examples**

The following examples show how to call the Rerank API using the AWS SDKs.

---

#### [ Python ]

```
import boto3

client = boto3.client('bedrock-agent-runtime', region_name='us-east-1')
response = client.rerank(
    queries=[{
        'type': 'TEXT',
        'textQuery': {'text': 'What is Amazon Bedrock?'}
    }],
    sources=[
        {
            'type': 'INLINE',
            'inlineDocumentSource': {
                'type': 'TEXT',
                'textDocument': {'text': 'Amazon Bedrock is a fully managed service for foundation models.'}
            }
        },
        {
            'type': 'INLINE',
            'inlineDocumentSource': {
                'type': 'TEXT',
                'textDocument': {'text': 'Amazon S3 is an object storage service.'}
            }
        }
    ],
    rerankingConfiguration={
        'type': 'BEDROCK_RERANKING_MODEL',
        'bedrockRerankingConfiguration': {
            'modelConfiguration': {
                'modelArn': 'arn:aws:bedrock:us-east-1::foundation-model/cohere.rerank-v3-5:0'
            },
            'numberOfResults': 2
        }
    }
)
for result in response['results']:
    print(f'Index: {result["index"]}, Score: {result["relevanceScore"]}')
```

---

#### [ Node.js ]

```
import { BedrockAgentRuntimeClient, RerankCommand } from "@aws-sdk/client-bedrock-agent-runtime";

const client = new BedrockAgentRuntimeClient({ region: "us-east-1" });
const response = await client.send(new RerankCommand({
    queries: [{
        type: "TEXT",
        textQuery: { text: "What is Amazon Bedrock?" }
    }],
    sources: [
        {
            type: "INLINE",
            inlineDocumentSource: {
                type: "TEXT",
                textDocument: { text: "Amazon Bedrock is a fully managed service for foundation models." }
            }
        },
        {
            type: "INLINE",
            inlineDocumentSource: {
                type: "TEXT",
                textDocument: { text: "Amazon S3 is an object storage service." }
            }
        }
    ],
    rerankingConfiguration: {
        type: "BEDROCK_RERANKING_MODEL",
        bedrockRerankingConfiguration: {
            modelConfiguration: {
                modelArn: "arn:aws:bedrock:us-east-1::foundation-model/cohere.rerank-v3-5:0"
            },
            numberOfResults: 2
        }
    }
}));
for (const result of response.results) {
    console.log(`Index: ${result.index}, Score: ${result.relevanceScore}`);
}
```

---

---
