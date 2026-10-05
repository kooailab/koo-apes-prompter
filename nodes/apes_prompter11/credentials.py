"""Server-session credentials, scoped to one provider and normalized endpoint."""
import os
from threading import Lock

from .providers.base import ProviderError
from .providers.registry import create_provider

_keys = {}
_lock = Lock()


def credential_scope(settings):
    provider = create_provider(settings)
    return provider.name, provider.base_url


def set_session_key(settings, key):
    if not isinstance(key, str) or len(key) > 8192 or "\n" in key or "\r" in key:
        raise ProviderError("Invalid API key.", "configuration")
    scope = credential_scope(settings)
    with _lock:
        if key:
            _keys[scope] = key
        else:
            _keys.pop(scope, None)


def get_api_key(settings):
    scope = credential_scope(settings)
    with _lock:
        key = _keys.get(scope)
    if key is not None:
        return key
    endpoint = os.environ.get("KOO_PROMPTER11_API_BASE_URL", "")
    if endpoint and credential_scope({**settings, "base_url": endpoint}) == scope:
        return os.environ.get("KOO_PROMPTER11_API_KEY", "")
    return ""
