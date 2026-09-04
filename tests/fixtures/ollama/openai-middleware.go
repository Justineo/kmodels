package middleware

type ChatWriter struct{}

func (w *ChatWriter) writeResponse(chatResponse api.ChatResponse) {
	if w.streamOptions != nil && w.streamOptions.IncludeUsage {
		u := openai.ToUsage(chatResponse)
		finishChunk.Usage = &u
		finishChunk.Choices = []openai.ChunkChoice{}
	}
}

type CompleteWriter struct{}

func (w *CompleteWriter) writeResponse(generateResponse api.GenerateResponse) {
	if w.streamOptions != nil && w.streamOptions.IncludeUsage {
		u := openai.ToUsageGenerate(generateResponse)
		chunk.Usage = &u
		chunk.Choices = []openai.CompleteChunkChoice{}
	}
}

type ResponsesWriter struct{}

func (w *ResponsesWriter) writeResponse(chatResponse api.ChatResponse) {
	w.ResponseWriter.Header().Set("Content-Type", "text/event-stream")
	w.converter = openai.NewResponsesStreamConverter(responseID, itemID, model, request)
	response := openai.ToResponse(model, responseID, itemID, chatResponse, request)
}
