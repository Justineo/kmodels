Build a voice conversation with `openai/gpt-live-1` through AI Gateway.

## Close the session

To stop the conversation and collect final usage:

1. Stop audio input and new delegated work.
2. Send one `{ "type": "session.close" }` event.
3. Continue reading audio and usage events until `session.closed` arrives, allowing up to five seconds for finalization.
4. Read `session.closed.usage.seconds`, finish writing or playing queued audio, and close the WebSocket.

The Node.js example follows this sequence and enforces a 45-second overall timeout. If the transport fails or the final event never arrives, treat final usage as unconfirmed. Muting the microphone or pausing audio input does not end the session.

## Usage and pricing

GPT-Live voice sessions cost **$3 per hour**, equivalent to **$0.05 per minute**, at the [current provider list price](https://developers.openai.com/api/docs/models/gpt-live-1#pricing). Billing uses seconds, without rounding up to a whole minute. For example, 90 seconds costs $0.075 at that rate.

| Usage                        | How charges work                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Voice session                | Provider-reported duration, including silence, microphone mute, and time waiting for backend work |
| Separate model or tool calls | Their own pricing, in addition to voice session charges                                           |

`session.usage.updated.usage.seconds` and `session.closed.usage.seconds` are **cumulative totals**. Do not sum successive snapshots or substitute a local wall-clock timer for provider usage. Check [AI Gateway pricing](/docs/ai-gateway/pricing) for credits and billing details. [Close the session](#close-the-session) to stop further voice session charges.

If you encounter incorrect information, can’t find what you need, need a capability Vercel doesn’t currently offer, or have any other feedback to report, please do it by following the instructions at https://vercel.com/feedback.md.
