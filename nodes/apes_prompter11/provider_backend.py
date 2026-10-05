"""Bridge the common provider contract to the preserved visual director pipeline."""
from .backends.base import PromptDirectorBackend
from .credentials import get_api_key
from .providers.base import GenerationRequest, ProviderError
from .providers.registry import create_provider, engine_settings


class ProviderBackend(PromptDirectorBackend):
    def __init__(self, settings):
        self.settings = settings
        self.provider = create_provider(settings, api_key=get_api_key(settings))
        self.name = self.provider.name
        self.model = settings["engine_model"]
        self.supports_vision = self.provider.capabilities.supports_images and settings["model_supports_images"]
        self.last_result = None
        self.last_warning = ""
        if not self.model:
            raise ProviderError("Select or enter a model ID.", "configuration")

    def generate(self, instruction):
        self.validate_instruction(instruction)
        sampling = {key: self.settings["sampling_nonce" if key == "seed" else key] if self.settings["sampling_nonce" if key == "seed" else key] >= 0 else None
                    for key in ("temperature", "top_p", "top_k", "seed")}
        context = instruction.diagnostic_context or {}
        request = GenerationRequest(
            model=self.model, messages=instruction.to_messages(),
            timeout=self.settings["timeout"], max_tokens=self.settings["max_output_tokens"],
            options={"creativity": context.get("creativity", "Balanced"),
                     "send_sampling": self.settings["send_sampling"], "token_field": self.settings["token_field"]},
            **sampling,
        )
        self.last_result = self.provider.generate(request)
        self.last_warning = (
            "Output token limit reached; the prompt may be incomplete. Increase Max Output Tokens."
            if self.last_result.finish_reason in {"length", "max_tokens"} else ""
        )
        return self.last_result.text

