package api

type Metrics struct {
	PromptEvalCount       int  `json:"prompt_eval_count,omitempty"`
	PromptEvalCachedCount *int `json:"prompt_eval_cached_count,omitempty"`
	EvalCount             int  `json:"eval_count,omitempty"`
}

type ChatResponse struct {
	Done bool `json:"done"`
	Metrics
}

type GenerateResponse struct {
	Done bool `json:"done"`
	Metrics
}
