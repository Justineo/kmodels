# Priority Tier

Reduced synthetic contract fixture based on the reviewed guide.
Standard Tier is the base schedule; the multiplier is 1.75x.
Its token scope is input, output, and cached tokens.
The multiplier applies after the prompt cache discount.

The response usage object identifies what processed the request.

| Response   | Description           |
| ---------- | --------------------- |
| `priority` | Prioritized execution |
| `standard` | Ordinary execution    |

```json
{ "usage": { "service_tier": "priority" } }
```
