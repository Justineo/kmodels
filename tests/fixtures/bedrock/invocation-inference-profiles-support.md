# Supported Regions and models for inference profiles

<a name="inference-profiles-support"></a>

For a list of Region codes and endpoints supported in Amazon Bedrock, see [Amazon Bedrock endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html#bedrock_region). This topic describes predefined inference profiles that you can use and the Regions and models that support application inference profiles.

**Note**  
Looking for inference profile IDs for a specific model? Each model's inference profile IDs and Regional availability are now documented on the model's detail page. Visit [models at a glance](model-cards.md) and choose the model you are interested in.

**Topics**

- [Find supported cross-Region inference profiles](#inference-profiles-support-system)
- [Supported Regions and models for application inference profiles](#inference-profiles-support-user)

## Find supported cross-Region inference profiles

<a name="inference-profiles-support-system"></a>

You can carry out [cross-Region inference](cross-region-inference.md) with cross-Region (system-defined) inference profiles. With cross-Region inference, you can distribute traffic across multiple AWS Regions by using compute in each of those Regions.

Cross-Region (system-defined) inference profiles are named after the model that they support and defined by the Regions that they support. To understand how a cross-Region inference profile handles your requests, review the following definitions:

- **Source Region** – The Region from which you make the API request that specifies the inference profile.
- **Destination Region** – A Region to which the Amazon Bedrock service can route the request from your source Region.

When you invoke a cross-Region inference profile in Amazon Bedrock, your request originates from a source Region and is automatically routed to one of the destination Regions defined in that profile, optimizing for performance. The destination Regions for Global cross-Region inference profiles include all commercial Regions.

**Note**  
The destination Regions in a cross-Region inference profile can include _opt-in Regions_, which are Regions that you must explicitly enable at AWS account or Organization level. To learn more, see [Enable or disable AWS Regions in your account](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-regions.html). When using a cross-Region inference profile, your inference request can be routed to any of the destination Regions in the profile, even if you did not opt-in to such Regions in your account. Your input prompts and output results may be stored in the opt-in Regions for abuse detection purposes.

Service Control Policies (SCPs) and AWS Identity and Access Management (IAM) policies work together to control where cross-Region inference is allowed. Using SCPs, you can control which Regions Amazon Bedrock can use for inference, and using IAM policies, you can define which users or roles have permission to run inference. If any destination Region in a cross-Region inference profile is blocked in your SCPs, the request will fail even if other Regions remain allowed. To ensure efficient operation with cross-Region inference, you can update your SCPs and IAM policies to allow all required Amazon Bedrock inference actions (for example, `bedrock:InvokeModel*` or `bedrock:CreateModelInvocationJob`) in all destination Regions included in your chosen inference profile. To learn more, see [Enabling Amazon Bedrock cross-Region inference in multi-account environments.](https://aws.amazon.com/blogs/machine-learning/enable-amazon-bedrock-cross-region-inference-in-multi-account-environments/)

**Note**  
Some inference profiles route to different destination Regions depending on the source Region from which you call it. For example, if you call `us.anthropic.claude-3-haiku-20240307-v1:0` from US East (Ohio), it can route requests to `us-east-1`, `us-east-2`, or `us-west-2`, but if you call it from US West (Oregon), it can route requests to only `us-east-1` and `us-west-2`.

To check the source and destination Regions for an inference profile, you can do one of the following:

- Open [models at a glance](model-cards.md), choose the model, and review its _Regional availability_ section for inference profile IDs, source Regions, and destination Regions.
- Send a [GetInferenceProfile](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetInferenceProfile.html) request with an [Amazon Bedrock control plane endpoint](https://docs.aws.amazon.com/general/latest/gr/bedrock.html#br-cp) from a source Region and specify the Amazon Resource Name (ARN) or ID of the inference profile in the `inferenceProfileIdentifier` field. The `models` field in the response maps to a list of model ARNs, in which you can identify each destination Region.

**Note**  
Global cross-Region inference profile for a specific model can change over time as AWS adds more commercial Regions where your requests can be processed. However, if an inference profile is tied to a geography (such as US, EU, or APAC), its destination Region list will never change. AWS might create new inference profiles that incorporate new Regions. You can update your systems to use these inference profiles by changing the IDs in your setup to the new ones.  
The Global cross-Region inference profile is currently only supported on Anthropic Claude Sonnet 4 model for the following source Regions: US West (Oregon), US East (N. Virginia), US East (Ohio), Europe (Ireland), and Asia Pacific (Tokyo). The destination Regions for Global inference profile include all commercial AWS Regions.

You can find supported cross-Region inference profiles in either of the following ways:

- **Browse by model:** Visit [models at a glance](model-cards.md) and choose a model. On the model's detail page, the _Regional availability_ table shows which Regions support In-Region, geography-based, and Global inference profiles. The _Inference profile IDs_ section lists the profile IDs, supported source Regions, and destination Regions.
- **Query a source Region:** Send a [ListInferenceProfiles](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_ListInferenceProfiles.html) request to an Amazon Bedrock control plane endpoint in the Region that you plan to use. The response includes the system-defined inference profiles that are currently available from that source Region.

For example, the following AWS CLI command lists the active AU inference profiles that you can use from the Asia Pacific (Sydney) Region:

```
aws bedrock list-inference-profiles \
    --region ap-southeast-2 \
    --type-equals SYSTEM_DEFINED \
    --query "inferenceProfileSummaries[?status=='ACTIVE' && starts_with(inferenceProfileId, 'au.')].[inferenceProfileId,inferenceProfileName]" \
    --output table
```

For each inference profile that you want to use, send a [GetInferenceProfile](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetInferenceProfile.html) request from the same source Region. The Region in each model ARN in the `models` field is a destination Region to which the inference profile can route requests. For example:

```
aws bedrock get-inference-profile \
    --region ap-southeast-2 \
    --inference-profile-identifier {{inference-profile-id}} \
    --query 'models[].modelArn'
```

**Important**  
If you have data residency requirements, call [GetInferenceProfile](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetInferenceProfile.html) from every source Region that you plan to use and verify all destination Regions in the response. Available inference profiles and destination Regions can differ depending on the source Region. Don't rely on the geographic prefix in an inference profile ID alone to determine where requests can be routed.

## Supported Regions and models for application inference profiles

<a name="inference-profiles-support-user"></a>

Application inference profiles can be created for supported models in the following AWS Regions:

- af-south-1
- ap-east-2
- ap-northeast-1
- ap-northeast-2
- ap-northeast-3
- ap-south-1
- ap-south-2
- ap-southeast-1
- ap-southeast-2
- ap-southeast-3
- ap-southeast-4
- ap-southeast-5
- ap-southeast-6
- ap-southeast-7
- ca-central-1
- ca-west-1
- eu-central-1
- eu-central-2
- eu-north-1
- eu-south-1
- eu-south-2
- eu-west-1
- eu-west-2
- eu-west-3
- il-central-1
- me-central-1
- me-south-1
- mx-central-1
- sa-east-1
- us-east-1
- us-east-2
- us-gov-east-1
- us-gov-west-1
- us-west-1
- us-west-2

Application inference profiles can be created from any foundation model or cross-Region (system-defined) inference profile supported in Amazon Bedrock, including embedding models. Specify a foundation model if the model supports on-demand inference in the Region where you create the profile, or a cross-Region (system-defined) inference profile if the model is served only through an inference profile. To check how a model is served in a given Region, see [models at a glance](model-cards.md).
