import time
from urllib.parse import urlsplit

from .base import Capabilities, GenerationResult, Provider, ProviderError


class OpenAICompatibleProvider(Provider):
    name = "openai_compatible"
    capabilities = Capabilities(supports_reasoning=True)

    def __init__(self, base_url, **kwargs):
        super().__init__(base_url, **kwargs)
        if self.base_url.endswith("/chat/completions"):
            self.base_url = self.base_url[:-len("/chat/completions")]
        if not urlsplit(self.base_url).path:
            self.base_url += "/v1"

    def discover_models(self, timeout=10):
        data = self.http("/models", timeout=timeout)
        if not isinstance(data, dict) or not isinstance(data.get("data"), list):
            raise ProviderError("Unsupported response format.", "format")
        if any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in data["data"]):
            raise ProviderError("Unsupported response format.", "format")
        return sorted({item["id"] for item in data["data"] if item["id"]})

    def generate(self, request):
        payload = {"model": request.model, "messages": request.to_messages(), "stream": False}
        token_field = request.options.get("token_field", "max_tokens")
        if token_field not in {"max_tokens", "max_completion_tokens"}:
            raise ProviderError("Invalid output token option.", "configuration")
        payload[token_field] = request.max_tokens
        if request.options.get("send_sampling", True):
            for key in ("temperature", "top_p", "seed"):
                if getattr(request, key) is not None:
                    payload[key] = getattr(request, key)
        started = time.monotonic()
        data = self.http("/chat/completions", payload, request.timeout)
        try:
            choice = data["choices"][0]
            message = choice["message"]
            content = message.get("content")
            if isinstance(content, list):
                content = "".join(part["text"] for part in content if part.get("type") in {"text", "output_text"})
            if content is None:
                content = ""
            if not isinstance(content, str):
                raise TypeError()
            usage = data.get("usage") or {}
            if not isinstance(usage, dict):
                raise TypeError()
        except (KeyError, IndexError, TypeError, AttributeError):
            raise ProviderError("Unsupported response format.", "format") from None
        if not content.strip():
            raise ProviderError("Model returned an empty response.", "empty")
        return GenerationResult(
            text=content.strip(), provider=self.name, model=str(data.get("model") or request.model),
            reasoning=str(message.get("reasoning_content") or message.get("reasoning") or ""),
            finish_reason=str(choice.get("finish_reason") or "unknown"),
            prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"), duration=time.monotonic() - started,
            raw_metadata=data,
        )
