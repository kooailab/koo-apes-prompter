from dataclasses import asdict
import math

from .base import Capabilities, ProviderError
from .ollama_native import OllamaNativeProvider
from .openai_compatible import OpenAICompatibleProvider


PROVIDERS = {"ollama_native": OllamaNativeProvider, "openai_compatible": OpenAICompatibleProvider}
PRESETS = {
    "Ollama Native": {"provider": "ollama_native", "base_url": "http://127.0.0.1:11434"},
    "llama.cpp": {"provider": "local_llama_cpp", "base_url": "http://127.0.0.1:8189/v1"},
    "LM Studio": {"provider": "openai_compatible", "base_url": "http://127.0.0.1:1234/v1"},
    "vLLM": {"provider": "openai_compatible", "base_url": "http://127.0.0.1:8000/v1"},
    "LocalAI": {"provider": "openai_compatible", "base_url": "http://127.0.0.1:8080/v1"},
    "OpenRouter": {"provider": "openai_compatible", "base_url": "https://openrouter.ai/api/v1"},
    "Custom OpenAI Compatible": {"provider": "openai_compatible", "base_url": "http://127.0.0.1:8080/v1"},
}
ENGINE_DEFAULTS = {
    "provider_preset": "Ollama Native", "engine_model": "", "base_url": "http://127.0.0.1:11434",
    "timeout": 600.0, "max_output_tokens": 8192, "temperature": -1.0, "top_p": -1.0,
    "top_k": -1, "sampling_nonce": -1, "send_sampling": True, "token_field": "max_tokens",
    "model_supports_images": True,
}


def engine_settings(values):
    source = values or {}
    settings = {key: source.get(key, default) for key, default in ENGINE_DEFAULTS.items()}
    preset = PRESETS.get(settings["provider_preset"])
    if preset is None:
        raise ProviderError("Unknown provider preset.", "configuration")
    settings["provider"] = preset["provider"]
    settings["base_url"] = str(source.get("base_url") or preset["base_url"])
    settings["engine_model"] = str(settings["engine_model"]).strip()
    for key, minimum, maximum, kind in (
        ("timeout", 0.25, 3600, float), ("max_output_tokens", 1, 1048576, int),
        ("temperature", -1, 2, float), ("top_p", -1, 1, float),
        ("top_k", -1, 1000, int), ("sampling_nonce", -1, 2147483647, int),
    ):
        try:
            settings[key] = kind(settings[key])
            if not math.isfinite(settings[key]) or not minimum <= settings[key] <= maximum:
                raise ValueError()
        except (ValueError, TypeError, OverflowError):
            raise ProviderError(f"Invalid {key.replace('_', ' ')}.", "configuration") from None
    for key in ("send_sampling", "model_supports_images"):
        settings[key] = settings[key] is True or str(settings[key]).lower() == "true"
    return settings


def create_provider(settings, api_key="", opener=None):
    provider_class = PROVIDERS[settings["provider"]]
    return provider_class(settings["base_url"], api_key=api_key, opener=opener)


def public_presets():
    return {name: {**preset, "capabilities": asdict(Capabilities(supports_unload=True, supports_top_p=False, supports_seed=False)
                              if preset["provider"] == "local_llama_cpp" else PROVIDERS[preset["provider"]].capabilities)}
            for name, preset in PRESETS.items()}

