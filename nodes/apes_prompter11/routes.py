"""Versioned HTTP API for KoO Apes Prompter 1.1."""
import asyncio
import ipaddress
from urllib.parse import urlsplit

from .core import PromptDirectorRequest, PromptDirectorService
from .local_runtime import local_backend, local_inventory
from .gguf_browser import browse_gguf, select_gguf
from .backends.base import PromptDirectorError
from .backends.llama_cpp_process import get_process_manager
from .providers.base import ProviderError
from .providers.registry import engine_settings, create_provider, public_presets
from .credentials import get_api_key, set_session_key
from .presets import (DEFAULT_DIRECTOR_PRESET, DirectorLibraryError, delete_user_director,
                      list_director_presets, resolve_user_director_directory, save_user_director)

PREFIX = "/koo/prompter11/v1"
ROUTE_PATH = PREFIX + "/generate"
TEXT_ROUTE_PATH = PREFIX + "/generate-text"
MODELS_ROUTE_PATH = PREFIX + "/models"
PRESETS_ROUTE_PATH = PREFIX + "/presets"
UNLOAD_ROUTE_PATH = PREFIX + "/unload"


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return False
    if not hasattr(PromptServer, "instance"):
        return False

    async def operation(request, action):
        try:
            origin = request.headers.get("Origin")
            if origin and urlsplit(origin).netloc != request.host:
                return web.json_response({"ok": False, "error": "Cross-origin request rejected."}, status=403)
            payload = await request.json()
            if not isinstance(payload, dict):
                raise ValueError()
            if action in {"browse-gguf", "select-gguf", "runtime-status", "runtime-install", "runtime-repair", "runtime-remove", "runtime-override", "browse-server"}:
                # Arbitrary host paths are available only to the local UI.
                host = urlsplit("//" + request.host).hostname
                try:
                    local_peer = ipaddress.ip_address(request.remote).is_loopback
                    local_host = host == "localhost" or ipaddress.ip_address(host).is_loopback
                except ValueError:
                    local_peer = local_host = False
                if not local_peer or not local_host or request.headers.get("Sec-Fetch-Site") == "cross-site":
                    return web.json_response({"ok": False, "error": "Browse GGUF is local-only. Open ComfyUI using localhost on the computer holding the models."}, status=403)
                if engine_settings(payload)["provider"] != "local_llama_cpp":
                    raise ProviderError("Browse GGUF is only available for Local llama.cpp.", "configuration")
                if action.startswith('runtime-') or action == 'browse-server':
                    from .managed_runtime import runtime_status, install_runtime, remove_runtime, save_override, browse_servers
                    variant = payload.get('variant', 'windows-x64-cpu')
                    operations = {'runtime-status': (runtime_status, ()), 'runtime-install': (install_runtime, (variant,)),
                                  'runtime-repair': (install_runtime, (variant, True)),
                                  'runtime-remove': (remove_runtime, (variant,)),
                                  'runtime-override': (save_override, (payload.get('llama_server', ''),)),
                                  'browse-server': (browse_servers, (payload.get('directory', ''),))}
                    function, args = operations[action]
                    result = await asyncio.to_thread(function, *args)
                    return web.json_response({'ok': True, **result})
                if action == "browse-gguf":
                    result = await asyncio.to_thread(browse_gguf, payload.get("directory", ""))
                else:
                    result = await asyncio.to_thread(select_gguf, payload.get("engine_model", ""),
                        payload.get("director_mmproj_path", ""), engine_settings(payload)["model_supports_images"])
                return web.json_response({"ok": True, **result})
            if action == 'ollama-status':
                from .providers.ollama_native import OllamaNativeProvider
                try:
                    models = await asyncio.to_thread(OllamaNativeProvider(payload.get('base_url') or 'http://127.0.0.1:11434').discover_models, 3)
                    return web.json_response({'ok': True, 'detected': True, 'models': models})
                except ProviderError:
                    return web.json_response({'ok': True, 'detected': False, 'models': []})
            if action in {"generate", "generate-text"}:
                director_request = PromptDirectorRequest.from_mapping(payload)
                service = PromptDirectorService()
                method = service.generate_text_only if action == "generate-text" else service.generate
                result = await asyncio.to_thread(method, director_request)
                return web.json_response({"ok": True, "prompt": result.prompt,
                    "backend": result.backend_name, "prompt_model": result.prompt_model,
                    "director_preset": result.director_preset, "warning": result.warning})
            settings = engine_settings(payload)
            if settings["provider"] == "local_llama_cpp":
                if action == "models":
                    inventory = await asyncio.to_thread(local_inventory)
                    from .managed_runtime import runtime_status
                    inventory['runtime'] = await asyncio.to_thread(runtime_status)
                    selected = settings["engine_model"]
                    if selected and (selected.lower().endswith(".gguf") or selected.startswith(("/", "\\"))):
                        try:
                            await asyncio.to_thread(select_gguf, selected, payload.get("director_mmproj_path", ""), settings["model_supports_images"])
                        except PromptDirectorError as exc:
                            inventory["selection_error"] = str(exc)
                    return web.json_response({"ok": True, "connection": "local", **inventory,
                        "message": "Local models ready; llama-server starts automatically on Generate."})
                if action == "test-connection":
                    backend, _, _ = await asyncio.to_thread(
                        local_backend, PromptDirectorRequest.from_mapping(payload), settings)
                    return web.json_response({"ok": True, "connection": "local",
                        "message": f"{backend.config.requested_model} ready; starts automatically on Generate."})
                if action == "unload":
                    state = await asyncio.to_thread(get_process_manager().request_unload)
                    return web.json_response({"ok": True, "message": f"Local model: {state}."})
                raise ProviderError("The managed local server does not use API keys.", "configuration")
            if action == "credentials":
                set_session_key(settings, payload.get("api_key", ""))
                return web.json_response({"ok": True, "message": "Session credential updated."})
            provider = create_provider(settings, api_key=get_api_key(settings))
            timeout = min(settings["timeout"], 30)
            if action == "models":
                models = await asyncio.to_thread(provider.discover_models, timeout)
                return web.json_response({"ok": True, "connection": "success", "models": models,
                                          "message": f"Server reachable; {len(models)} models found."})
            if action == "test-connection":
                result = await asyncio.to_thread(provider.test_connection, settings["engine_model"], timeout)
                return web.json_response(result)
            if action == "unload":
                if not settings["engine_model"]:
                    raise ProviderError("Select a model first.", "configuration")
                result = await asyncio.to_thread(provider.unload, settings["engine_model"], timeout)
                return web.json_response(result)
        except ProviderError as exc:
            return web.json_response({"ok": False, "connection": "failure", "error": str(exc), "code": exc.code}, status=400)
        except PromptDirectorError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except (ValueError, TypeError):
            return web.json_response({"ok": False, "error": "Invalid request settings."}, status=400)
        except Exception:
            return web.json_response({"ok": False, "error": "Prompt generation failed; check model and image support."}, status=500)

    def register_action(action):
        async def handler(request):
            return await operation(request, action)
        PromptServer.instance.routes.post(PREFIX + "/" + action)(handler)

    for action in ("generate", "generate-text", "models", "test-connection", "credentials", "unload", "browse-gguf", "select-gguf", "runtime-status", "runtime-install", "runtime-repair", "runtime-remove", "runtime-override", "browse-server", "ollama-status"):
        register_action(action)

    @PromptServer.instance.routes.get(PREFIX + "/engine-presets")
    async def engine_presets(request):
        return web.json_response({"ok": True, "presets": public_presets()})

    @PromptServer.instance.routes.get(PRESETS_ROUTE_PATH)
    async def list_presets(request):
        presets, warnings = await asyncio.to_thread(list_director_presets)
        return web.json_response({
            "ok": True,
            "default": DEFAULT_DIRECTOR_PRESET,
            "presets": presets,
            "warnings": warnings,
            "storage": str(resolve_user_director_directory()),
        })

    @PromptServer.instance.routes.post(PRESETS_ROUTE_PATH)
    async def save_preset(request):
        try:
            if request.headers.get('Origin') and urlsplit(request.headers['Origin']).netloc != request.host:
                return web.json_response({'ok': False, 'error': 'Cross-origin request rejected.'}, status=403)
            payload = await request.json()
            director, path = await asyncio.to_thread(
                save_user_director,
                payload.get("name"),
                payload.get("instructions"),
                payload.get("recommended_mode"),
            )
            return web.json_response({
                "ok": True,
                "director": director.to_public_mapping(),
                "file": path.name,
            })
        except (DirectorLibraryError, ValueError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "The user Director could not be saved."},
                status=500,
            )

    @PromptServer.instance.routes.delete(PRESETS_ROUTE_PATH)
    async def delete_preset(request):
        try:
            if request.headers.get('Origin') and urlsplit(request.headers['Origin']).netloc != request.host:
                return web.json_response({'ok': False, 'error': 'Cross-origin request rejected.'}, status=403)
            payload = await request.json()
            director, path = await asyncio.to_thread(
                delete_user_director,
                payload.get("name") or payload.get("id"),
            )
            return web.json_response({
                "ok": True,
                "director": director.to_public_mapping(),
                "file": path.name,
            })
        except (DirectorLibraryError, ValueError) as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        except Exception:
            return web.json_response(
                {"ok": False, "error": "The user Director could not be deleted."},
                status=500,
            )

    return True
