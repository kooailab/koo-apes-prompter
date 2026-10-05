from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import json
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from ..backends.base import PromptDirectorError


class ProviderError(PromptDirectorError):
    def __init__(self, message, code="provider_error", status=None):
        super().__init__(message)
        self.code = code
        self.status = status


def normalize_endpoint(value):
    try:
        parsed = urlsplit(str(value).strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or not parsed.port and parsed.netloc.endswith(":"):
            raise ValueError()
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))
    except ValueError:
        raise ProviderError("Enter an HTTP(S) base URL without credentials, query or fragment.", "configuration") from None


@dataclass(frozen=True)
class Capabilities:
    supports_model_discovery: bool = True
    supports_thinking: bool = False
    supports_reasoning: bool = False
    supports_streaming: bool = False
    supports_images: bool = True
    supports_seed: bool = True
    supports_temperature: bool = True
    supports_top_p: bool = True
    supports_top_k: bool = False
    supports_usage: bool = True
    supports_system_prompt: bool = True
    supports_unload: bool = False


@dataclass(frozen=True)
class GenerationRequest:
    model: str
    messages: list = field(default_factory=list)
    system_prompt: str = ""
    images: tuple = ()
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    max_tokens: int = 8192
    seed: int | None = None
    timeout: float = 600
    options: dict = field(default_factory=dict)

    def to_messages(self):
        messages = [dict(message) for message in self.messages]
        if self.system_prompt:
            messages.insert(0, {"role": "system", "content": self.system_prompt})
        if self.images:
            messages.append({"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": image.data_url}}
                for image in self.images
            ]})
        return messages


@dataclass(frozen=True)
class GenerationResult:
    text: str
    provider: str
    model: str
    thinking: str = ""
    reasoning: str = ""
    finish_reason: str = ""
    done_reason: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    duration: float | None = None
    completed: bool = True
    raw_metadata: dict = field(default_factory=dict)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Provider(ABC):
    name = "unknown"
    capabilities = Capabilities()

    def __init__(self, base_url, api_key="", opener=None):
        self.base_url = normalize_endpoint(base_url)
        self._api_key = api_key
        self._open = opener or build_opener(NoRedirect()).open

    def redact(self, value):
        if isinstance(value, str):
            return value.replace(self._api_key, "[REDACTED]") if self._api_key else value
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        if isinstance(value, dict):
            return {self.redact(key): self.redact(item) for key, item in value.items()}
        return value

    def http(self, path, payload=None, timeout=10, ndjson=False):
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = "Bearer " + self._api_key
        try:
            request = Request(self.base_url + path, headers=headers,
                              data=None if payload is None else json.dumps(payload).encode("utf-8"),
                              method="GET" if payload is None else "POST")
            with self._open(request, timeout=timeout) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            status = exc.code
            if status in {401, 403}:
                raise ProviderError("Authentication rejected.", "authentication", status) from None
            if status == 404:
                raise ProviderError("Model or API endpoint not found.", "not_found", status) from None
            raise ProviderError(f"Server returned HTTP {status}.", "http", status) from None
        except (TimeoutError, socket.timeout):
            raise ProviderError("Request timed out.", "timeout") from None
        except URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise ProviderError("Request timed out.", "timeout") from None
            raise ProviderError("Server unreachable.", "unreachable") from None
        except (OSError, ValueError, UnicodeError):
            raise ProviderError("Invalid connection or response.", "format") from None
        try:
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                if not ndjson:
                    raise
                data = [json.loads(line) for line in body.splitlines() if line.strip()]
            return self.redact(data)
        except (ValueError, TypeError):
            raise ProviderError("Unsupported response format.", "format") from None

    @abstractmethod
    def discover_models(self, timeout=10):
        pass

    @abstractmethod
    def generate(self, request):
        pass

    def model_matches(self, selected, models):
        return selected in models

    def test_connection(self, model="", timeout=10):
        try:
            models = self.discover_models(timeout)
        except ProviderError as exc:
            if exc.status in {404, 405, 501}:
                return {"ok": True, "connection": "success", "models": [], "model_checked": False,
                        "message": "Server reachable; discovery unsupported. Enter a model ID to generate."}
            raise
        if model and not self.model_matches(model, models):
            raise ProviderError("Selected model not found in discovery. Manual generation is still available.", "model_missing")
        return {"ok": True, "connection": "success", "models": models, "model_checked": bool(model),
                "message": "Selected model available." if model else f"Server reachable; {len(models)} models found."}

    def unload(self, model, timeout=10):
        raise ProviderError("This provider has no standard unload API.", "unsupported")
