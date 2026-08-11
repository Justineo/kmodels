# Cloud

Ollama's cloud models require an account on ollama.com.

Cloud models can also be accessed directly on ollama.com's API. In this mode, ollama.com acts as a remote Ollama host.

`curl https://ollama.com/api/tags`

`curl https://ollama.com/api/chat`

Ollama may deprecate and retire older cloud models.

Ollama Cloud model retirement does not affect local models.

### Upcoming retirements

| Retirement date | Model          | Recommended alternative |
| --------------- | -------------- | ----------------------- |
| July 31, 2026   | `minimax-m2.5` | `minimax-m2.7`          |
| July 31, 2026   | `kimi-k2.5`    | `kimi-k2.6`             |

### Past retirements

<AccordionGroup>
  <Accordion title="July 15, 2026">
    | Model                    | Recommended alternative |
    | ------------------------ | ----------------------- |
    | `gemini-3-flash-preview` | `minimax-m3`            |
  </Accordion>
</AccordionGroup>
