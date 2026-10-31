# Set up a model invocation resource using inference profiles

<a name="inference-profiles"></a>

_Inference profiles_ are a resource in Amazon Bedrock that define a model and one or more Regions to which the inference profile can route model invocation requests. You can use inference profiles for the following tasks:

- **Track usage metrics** – Set up CloudWatch logs and submit model invocation requests with an application inference profile to collect usage metrics for model invocation. You can examine these metrics when you view information about the inference profile and use them to inform your decisions. For more information about how to set up CloudWatch logs, see [Monitor model invocation using CloudWatch Logs and Amazon S3](model-invocation-logging.md).
- **Use tags to monitor costs** – Attach tags to an application inference profile to track costs when you submit on-demand model invocation requests. For more information on how to use tags for cost allocation, see [Organizing and tracking costs using AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html) in the AWS Billing user guide.
- **Cross-Region inference** – Use an inference profile that includes multiple AWS Regions. The inference profile distributes model invocation requests across these Regions. For more information about cross-Region inference, see [Route model inference requests across AWS Regions with cross-Region inference](cross-region-inference.md).

Amazon Bedrock offers the following types of inference profiles:

- **Cross Region (system-defined) inference profiles** – Inference profiles that are predefined in Amazon Bedrock and include multiple Regions to which requests for a model can be routed.
- **Application inference profiles** – Inference profiles that a user creates to track costs and model usage. You can create an inference profile that routes model invocation requests to one Region or to multiple Regions:
  - To create an inference profile that tracks costs and usage for a model in one Region, specify the foundation model in the Region to which you want the inference profile to route requests.
  - To create an inference profile that tracks costs and usage for a model across multiple Regions, specify the cross Region (system-defined) inference profile that defines the model and Regions to which you want the inference profile to route requests.

You can use inference profiles with the following features to route requests to multiple Regions and to track usage and cost for invocation requests made with these features:

- Model inference – Use an inference profile when running model invocation by choosing an inference profile in a playground in the Amazon Bedrock console, or by specifying the ARN of the inference profile when calling the [InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html), [InvokeModelWithResponseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html), [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html), and [ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html) operations. For more information, see [Making inference requests](inference.md).
- Knowledge base vector embedding and response generation – Use an inference profile when generating a response after querying a knowledge base or when parsing non-textual information in a data source. For more information, see [Test your knowledge base with queries and responses](knowledge-base-test.md) and [Parsing options for your data source](kb-advanced-parsing.md).
- Model evaluation – You can submit an inference profile as a model to evaluate when submitting a model evaluation job. For more information, see [Evaluate the performance of Amazon Bedrock resources](evaluation.md).
- Prompt management – You can use an inference profile when generating a response for a prompt you created in Prompt management. For more information, see [Construct and store reusable prompts with Prompt management in Amazon Bedrock](prompt-management.md)
- Flows – You can use an inference profile when generating a response for a prompt you define inline in a prompt node in a flow. For more information, see [Build an end-to-end generative AI workflow with Amazon Bedrock Flows](flows.md).

The price for using an inference profile is calculated based on the price of the model in the Region from which you call the inference profile. For information about pricing, see [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/).

For more details about cross-Region inference profiles, see [Route model inference requests across AWS Regions with cross-Region inference](cross-region-inference.md).

**Topics**

- [Supported Regions and models for inference profiles](inference-profiles-support.md)
- [Prerequisites for inference profiles](inference-profiles-prereq.md)
- [Create an application inference profile](inference-profiles-create.md)
- [Modify the tags for an application inference profile](inference-profiles-modify.md)
- [View information about an inference profile](inference-profiles-view.md)
- [Use an inference profile in model invocation](inference-profiles-use.md)
- [Delete an application inference profile](inference-profiles-delete.md)
