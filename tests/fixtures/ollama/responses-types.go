package openai

type ResponsesInputTokensDetails struct {
	CachedTokens int `json:"cached_tokens"`
}

type ResponsesUsage struct {
	InputTokens        int `json:"input_tokens"`
	OutputTokens       int `json:"output_tokens"`
	InputTokensDetails ResponsesInputTokensDetails `json:"input_tokens_details"`
}

func ToResponse(chatResponse api.ChatResponse) ResponsesResponse {
	return ResponsesResponse{Usage: &ResponsesUsage{
		InputTokens: chatResponse.PromptEvalCount,
		OutputTokens: chatResponse.EvalCount,
		InputTokensDetails: ResponsesInputTokensDetails{CachedTokens: intValue(chatResponse.PromptEvalCachedCount)},
	}}
}

func (c *ResponsesStreamConverter) Process(r api.ChatResponse) []ResponsesStreamEvent {
	usage := map[string]any{
		"input_tokens": r.PromptEvalCount,
		"output_tokens": r.EvalCount,
		"input_tokens_details": map[string]any{"cached_tokens": intValue(r.PromptEvalCachedCount)},
	}
	return []ResponsesStreamEvent{c.newEvent("response.completed", map[string]any{"response": usage})}
}
