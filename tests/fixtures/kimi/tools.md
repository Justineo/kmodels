# 联网搜索定价

<DocTable rows={[
["联网搜索", "1 次", "￥0.03", <>触发 <code>$web_search</code> 工具调用，计费一次</>],
]} />

当 finish_reason = tool_calls 时收费；当 finish_reason = stop 时不收费。total_tokens = prompt_tokens + search_tokens + completions_tokens。
