### Extended output (beta)

The `output-300k-2026-03-24` beta header raises the `max_tokens` cap to 300,000 for batch requests using Claude Opus 5.5, Claude Opus 5, Claude Opus 4.8, Claude Opus 4.7, Claude Opus 4.6, Claude Sonnet 5.5, Claude Sonnet 5, Claude Sonnet 4.6, or Claude Haiku 5.5. Include the header to generate outputs far longer than the standard 128k `max_tokens` limit in a single turn.

<Note>
  Extended output is available on the Message Batches API only, not the synchronous Messages API. It is available on the Claude API and Claude Platform on AWS.
</Note>
