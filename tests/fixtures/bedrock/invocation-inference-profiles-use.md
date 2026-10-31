# Use an inference profile in model invocation

<a name="inference-profiles-use"></a>

You can use a cross Region inference profile in place of a foundation model to route requests to multiple Regions. To track costs and usage for a model, in one or multiple Regions, you can use an application inference profile. To learn how to use an inference profile when running model inference, choose the tab for your preferred method, and then follow the steps:

---

#### [ Console ]

To use an inference profile with a feature that supports it, do the following:

1. Sign in to the AWS Management Console with an IAM identity that has permissions to use the Amazon Bedrock console. Then, open the Amazon Bedrock console at [https://console.aws.amazon.com/bedrock](https://console.aws.amazon.com/bedrock).

1. Navigate to the page for the feature that you want to use an inference profile for. For example, select **Chat / Text playground** from the left navigation pane.

1. Choose **Select model** and then choose the model. For example, choose **Amazon** and then **Nova Premier**.

1. Under **Inference**, select **Inference profiles** from the dropdown menu.

1. Select the inference profile to use (for example, **US Nova Premier**) and then choose **Apply**.

---

#### [ API ]

You can use an inference profile when running inference from any Region that is included in it with the following API operations:

- [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html) or [InvokeModelWithResponseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html) – To use an inference profile in model invocation, follow the steps at [Submit a single prompt with InvokeModel](inference-invoke.md) and specify the Amazon Resource Name (ARN) of the inference profile in the `modelId` field. For an example, see [Use an inference profile in model invocation](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html#API_runtime_InvokeModel_Example_5).
- [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) or [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html) – To use an inference profile in model invocation with the Converse API, follow the steps at [Inference using Converse API](conversation-inference.md) and specify the ARN of the inference profile in the `modelId` field. For an example, see [Use an inference profile in a conversation](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html#API_runtime_Converse_Example_5).
- [RetrieveAndGenerate](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RetrieveAndGenerate.html) – To use an inference profile when generating responses from the results of querying a knowledge base, follow the steps in the API tab in [Test your knowledge base with queries and responses](knowledge-base-test.md) and specify the ARN of the inference profile in the `modelArn` field. For more information, see [Use an inference proflie to generate a response](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_RetrieveAndGenerate.html#API_agent-runtime_RetrieveAndGenerate_Example_3).
- [CreateEvaluationJob](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_CreateEvaluationJob.html) – To submit an inference profile for model evaluation, follow the steps in the API tab in [Starting an automatic model evaluation job in Amazon Bedrock](model-evaluation-jobs-management-create.md) and specify the ARN of the inference profile in the `modelIdentifier` field.
- [CreatePrompt](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_CreatePrompt.html) – To use an inference profile when generating a response for a prompt you create in Prompt management, follow the steps in the API tab in [Create a prompt using Prompt management](prompt-management-create.md) and specify the ARN of the inference profile in the `modelId` field.
- [CreateFlow](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_CreateFlow.html) – To use an inference profile when generating a response for an inline prompt that you define within a prompt node in a flow, follow the steps in the API tab in [Create and design a flow in Amazon Bedrock](flows-create.md). In defining the [prompt node](flows-nodes.md#flows-nodes-prompt), specify the ARN of the inference profile in the `modelId` field.
- [CreateDataSource](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent_CreateDataSource.html) – To use an inference profile when parsing non-textual information in a data source, follow the steps in the API section in [Parsing options for your data source](kb-advanced-parsing.md) and specify the ARN of the inference profile in the `modelArn` field.

**Note**  
If you're using a cross-Region (system-defined) inference profile, you can use either the ARN or the ID of the inference profile.

---
