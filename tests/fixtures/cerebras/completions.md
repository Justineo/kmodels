# Completions

## Request

```shell
curl -X POST https://api.cerebras.ai/v1/completions
```

## Completion Response

<ParamField path="object" type="string" required="true">
  The object type, which is always `text_completion`.
</ParamField>

<ResponseField name="usage" type="object">
  Usage statistics for the completion request.
  <Expandable title="properties">
    <ResponseField name="prompt_tokens" type="integer">
      Number of tokens in the prompt.
    </ResponseField>
    <ResponseField name="completion_tokens" type="integer">
      Number of tokens in the generated completion.
    </ResponseField>
    <ResponseField name="prompt_tokens_details" type="object">
      <Expandable title="properties">
        <ResponseField name="cached_tokens" type="integer">
          Number of prompt tokens that were served from the cache and reused from a previous request.
        </ResponseField>
      </Expandable>
    </ResponseField>
  </Expandable>
</ResponseField>

Streaming responses use `object: text_completion` and return those same `usage` fields in the final
chunk.
