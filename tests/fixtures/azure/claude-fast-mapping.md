On [Claude in Microsoft Foundry](https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry), fast mode has its own model IDs, and the deployment sets the speed. Send fast mode requests to a deployment of the fast mode model, and leave out `speed`:

| Model             | Fast mode model ID       |
| ----------------- | ------------------------ |
| Claude Fable 5.2  | `claude-fable-5-2-fast`  |
| Claude Mythos 5.2 | `claude-mythos-5-2-fast` |
| Claude Opus 5.5   | `claude-opus-5-5-fast`   |

A request that sets `speed` on a deployment of the standard model, such as `claude-opus-5-5`, returns an error.
