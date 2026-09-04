# WebSearch Pricing

Prices exclude applicable taxes and are calculated at checkout.

<DocTable rows={[
[<code>{"$"}web_search</code>, "Per successful tool call", <>{"$"}0.005</>],
]} />

We charge when finish_reason = tool_calls and tool_call.function.name = $web_search, and do not charge when finish_reason = stop. total_tokens = prompt_tokens + search_tokens + completions_tokens.
