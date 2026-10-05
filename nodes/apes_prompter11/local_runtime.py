"""Connect the 1.1 engine selection to the preserved local llama.cpp runtime."""
from dataclasses import replace
import os
from pathlib import Path

from .config import load_config
from .portable_paths import portable_path
from .director_profiles import discover_director_profiles, resolve_director_config
from .backends.base import BackendConfigurationError
from .backends.local_llama_cpp import LocalLlamaCppBackend
from .gguf_browser import select_gguf


def local_config(config=None):
    current = load_config() if config is None else config
    legacy_path = Path(__file__).resolve().parents[3] / "koo-nodes/nodes/visual_prompt_director/config.json"
    try:
        import folder_paths

        user_path = Path(folder_paths.get_user_directory()) / "KoO/visual_prompt_director/config.json"
        if user_path.is_file():
            legacy_path = user_path
    except (ImportError, AttributeError):
        pass
    override = os.environ.get("KOO_PROMPT_DIRECTOR_CONFIG", "").strip()
    if override:
        legacy_path = portable_path(override)
    # Only inherit local runtime configuration; provider credentials stay isolated.
    inherited = load_config(legacy_path).get("local_llama_cpp", {})
    settings = {**inherited, **current.get("local_llama_cpp", {})}
    return {**current, "backend": "local_llama_cpp", "local_llama_cpp": settings}


def local_inventory():
    discovery = discover_director_profiles(local_config()["local_llama_cpp"], refresh=True)
    return {**discovery.to_public_mapping(),
            "models": [profile.profile_id for profile in discovery.profiles if profile.vision_ready]}


def local_backend(request, settings, config=None):
    config = local_config(config)
    selected = settings["engine_model"]
    discovery = discover_director_profiles(config["local_llama_cpp"])
    profile = discovery.by_id(selected)
    manual = Path(selected).is_absolute() or selected.lower().endswith(".gguf")
    if manual:
        chosen = select_gguf(selected, request.director_mmproj_path, settings["model_supports_images"])
        # An exact discovered pairing keeps its existing launch settings and identity.
        profile = next((item for item in discovery.profiles
                        if item.model_path == Path(chosen["path"])
                        and item.mmproj_path == (Path(chosen["mmproj"]) if chosen["mmproj"] else None)), None)
    if profile is not None:
        # The legacy resolver validates the exact discovered GGUF/mmproj pairing.
        request = replace(request, runtime="LLAMA.CPP", director_ai="", prompt_model="Custom",
                          director_profile=profile.profile_id)
    elif selected and not manual:
        profile = discovery.preferred_prompt_model(selected)
        if profile is None:
            raise BackendConfigurationError("Select a local GGUF model from Refresh Models.")
        request = replace(request, runtime="LLAMA.CPP", director_ai="", prompt_model=selected)
    else:
        request = replace(request, runtime="LLAMA.CPP", director_ai="")
    if manual and profile is None:
        local = {**config["local_llama_cpp"], "model_path": chosen["path"],
                 "mmproj_path": chosen["mmproj"], "text_only": not settings["model_supports_images"],
                 "requested_model": chosen["name"]}
        effective = {**config, "local_llama_cpp": local}
    else:
        effective, profile = resolve_director_config(config, request)
    local = effective["local_llama_cpp"]
    local["timeout"] = settings["timeout"]
    local["max_tokens"] = settings["max_output_tokens"]
    if settings["temperature"] >= 0:
        local["temperature"] = settings["temperature"]
    if profile is not None:
        local["requested_model"] = profile.label
    backend = LocalLlamaCppBackend(local)
    backend.supports_vision = settings["model_supports_images"]
    return backend, effective, profile
