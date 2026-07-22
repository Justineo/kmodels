class PromptGuardModel(BaseModel):
    description: str = "Prompt Guard. NOTE: this model will not be provided via `llama` CLI soon."
    max_seq_length: int = 512


def prompt_guard_model_skus():
    return [
        PromptGuardModel(
            model_id="Prompt-Guard-86M",
            huggingface_repo="meta-llama/Prompt-Guard-86M",
        ),
    ]
