if TYPE_CHECKING:
    from .resources import chat, models, uploads, moderations

if base_url is None:
    base_url = f"https://api.llama.com/v1"
