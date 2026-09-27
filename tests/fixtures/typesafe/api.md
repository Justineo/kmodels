# API reference

## Evaluation endpoint

```http
POST https://api.typesafe.ai/v1/systemone
```

## Question types

### Noul

A yes/no question. Returns the probability the answer is yes.

<ParamField body="type" type="&#x22;noul&#x22;" required />

### Choice

Picks one option from a set you define. Returns the chosen option and the full probability distribution.

<ParamField body="type" type="&#x22;choice&#x22;" required />

### Score

Rates the state along a rubric you define. Returns a probability-weighted value across your levels.

<ParamField body="type" type="&#x22;score&#x22;" required />

## Response body

One answer per question, returned under the same ids you provided.

<ResponseField name="model" type="string" required>
  The model that performed the evaluation.
</ResponseField>

<ResponseField name="usage" type="object" required>
  Token usage for the request.
  <Expandable title="properties">
    <ResponseField name="input_tokens" type="integer" />
    <ResponseField name="output_tokens" type="integer" />
  </Expandable>
</ResponseField>

## Answer types

Every answer carries a `type` matching its question.
