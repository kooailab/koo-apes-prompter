import json

from .base import Capabilities, GenerationResult, Provider, ProviderError
from ..backends.ollama import (
    _native_messages, _parse_native_chat_response, _merge_continuation,
    _with_completion_rule, is_qwen38_model, resolve_thinking_config,
    CONTINUATION_INSTRUCTION, QWEN38_SAMPLING_BY_CREATIVITY,
)
from ..backends.base import BackendGenerationError


class OllamaNativeProvider(Provider):
    name = "ollama_native"
    capabilities = Capabilities(supports_thinking=True, supports_top_k=True, supports_unload=True)

    def __init__(self, base_url, **kwargs):
        super().__init__(base_url, **kwargs)
        if self.base_url.endswith("/v1"):
            self.base_url = self.base_url[:-3]

    def discover_models(self, timeout=10):
        data = self.http("/api/tags", timeout=timeout)
        if not isinstance(data, dict) or not isinstance(data.get("models"), list):
            raise ProviderError("Unsupported response format.", "format")
        if any(not isinstance(item, dict) or not isinstance(item.get("name"), str) for item in data["models"]):
            raise ProviderError("Unsupported response format.", "format")
        return sorted({item["name"] for item in data["models"] if item["name"]})

    def model_matches(self, selected, models):
        return selected.removesuffix(":latest") in {item.removesuffix(":latest") for item in models}

    def generate(self, request):
        qwen = is_qwen38_model(request.model)
        messages = _native_messages(request.to_messages())
        if qwen:
            messages = _with_completion_rule(messages)
        options = {"num_predict": request.max_tokens}
        if qwen:
            options.update(QWEN38_SAMPLING_BY_CREATIVITY.get(request.options.get("creativity"), QWEN38_SAMPLING_BY_CREATIVITY["Balanced"]))
            options["num_ctx"] = request.options.get("num_ctx", 32768)
        for key in ("temperature", "top_p", "top_k", "seed"):
            value = getattr(request, key)
            if value is not None:
                options[key] = value
        candidates = resolve_thinking_config(request.model) if qwen else (None,)
        results = []
        packets = []
        combined = ""
        thinking = None
        for continuation in range(3 if qwen else 1):
            attempts = (thinking,) if thinking is not None else candidates
            for index, candidate in enumerate(attempts):
                payload = {"model": request.model, "messages": messages, "stream": False, "options": options}
                if candidate is not None:
                    payload["think"] = candidate
                try:
                    raw = self.http("/api/chat", payload, request.timeout, ndjson=True)
                    break
                except ProviderError as exc:
                    if qwen and exc.status in {400, 422} and index + 1 < len(attempts):
                        continue
                    raise
            packet_list = raw if isinstance(raw, list) else [raw]
            if not packet_list or any(not isinstance(packet, dict) for packet in packet_list):
                raise ProviderError("Unsupported response format.", "format")
            if any(packet.get("error") for packet in packet_list):
                raise ProviderError("Ollama generation failed.", "generation")
            try:
                result = _parse_native_chat_response("\n".join(json.dumps(packet) for packet in packet_list))
            except BackendGenerationError:
                raise ProviderError("Incomplete or unsupported Ollama response.", "format") from None
            thinking = candidate
            results.append(result)
            packets.extend(packet_list)
            combined = _merge_continuation(combined, result.content)
            if result.done_reason != "length":
                break
            messages = [*messages, {"role": "assistant", "content": combined},
                        {"role": "user", "content": CONTINUATION_INSTRUCTION}]
        if not combined.strip():
            raise ProviderError("Model returned an empty response.", "empty")
        prompt_tokens = sum(item.prompt_eval_count or 0 for item in results)
        completion_tokens = sum(item.eval_count or 0 for item in results)
        return GenerationResult(
            text=combined.strip(), provider=self.name, model=request.model,
            thinking="".join(item.thinking for item in results), done_reason=result.done_reason,
            finish_reason=result.done_reason, completed=result.done,
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            duration=sum(item.total_duration or 0 for item in results) / 1e9,
            raw_metadata={"responses": packets, "continuations": len(results) - 1},
        )

    def unload(self, model, timeout=10):
        self.http("/api/generate", {"model": model, "keep_alive": 0, "stream": False}, timeout)
        return {"ok": True, "status": "unloaded", "loaded": False, "message": "Selected Ollama model unloaded."}
