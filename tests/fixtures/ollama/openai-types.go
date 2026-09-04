package openai

type PromptTokensDetails struct {
	CachedTokens int `json:"cached_tokens"`
}

type Usage struct {
	PromptTokens        int                  `json:"prompt_tokens"`
	PromptTokensDetails *PromptTokensDetails `json:"prompt_tokens_details,omitempty"`
	CompletionTokens    int                  `json:"completion_tokens"`
}

func ToUsage(r api.ChatResponse) Usage {
	usage := Usage{PromptTokens: r.Metrics.PromptEvalCount, CompletionTokens: r.Metrics.EvalCount}
	if r.Metrics.PromptEvalCachedCount != nil {
		usage.PromptTokensDetails = &PromptTokensDetails{CachedTokens: *r.Metrics.PromptEvalCachedCount}
	}
	return usage
}

func ToUsageGenerate(r api.GenerateResponse) Usage {
	usage := Usage{PromptTokens: r.Metrics.PromptEvalCount, CompletionTokens: r.Metrics.EvalCount}
	if r.Metrics.PromptEvalCachedCount != nil {
		usage.PromptTokensDetails = &PromptTokensDetails{CachedTokens: *r.Metrics.PromptEvalCachedCount}
	}
	return usage
}
