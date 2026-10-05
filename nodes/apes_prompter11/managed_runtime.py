"""Apes-owned llama.cpp discovery, installation and configuration."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

from .backends.base import BackendConfigurationError
from .portable_paths import comfy_root, portable_path
from .config import load_config, resolve_config_path, _user_config_path

_LOCK = threading.Lock()
MISSING = 'Local llama.cpp runtime not found. Click INSTALL LOCAL RUNTIME or SELECT EXISTING LLAMA-SERVER.'


from .runtime_installer import (managed_directory, active_server, load_manifest,
                                installation_status, install_runtime, remove_runtime, extract_safe)


def discover_server(value=None, runtime_root=None):
    override = str(value or '').strip()
    if override and override.upper() != 'AUTO':
        path = portable_path(override)
        if not path.is_absolute() and runtime_root:
            path = portable_path(runtime_root) / path
        if path.is_file() and path.name.lower() in {'llama-server.exe', 'llama-server'}:
            return path.resolve()
        raise BackendConfigurationError(f'Llama Server override does not exist: {path}. Choose AUTO or Browse in Advanced.')
    root = comfy_root()
    managed = active_server() if root else None
    if managed:
        return managed
    locations = [root / 'tools/ApesPrompter/llama.cpp'] if root else []
    if runtime_root:
        locations.append(portable_path(runtime_root))
    if root:
        locations += [root / 'tools/KoO/llama.cpp', root]
    for directory in locations:
        for name in ('llama-server.exe', 'llama-server'):
            path = directory / name
            if path.is_file():
                return path.resolve()
    for name in ('llama-server.exe', 'llama-server'):
        found = shutil.which(name)
        if found:
            return Path(found).resolve()
    raise BackendConfigurationError(MISSING)


def validate_server(path):
    path = Path(path).resolve()
    if path.name.lower() not in {'llama-server.exe', 'llama-server'} or not path.is_file():
        raise BackendConfigurationError('Select an existing llama-server.exe (or llama-server), not a folder or another executable.')
    try:
        result = subprocess.run([str(path), '--version'], cwd=str(path.parent), capture_output=True,
                                timeout=30, shell=False, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BackendConfigurationError(f'llama-server launch validation failed: {exc}') from exc
    if result.returncode:
        code = result.returncode & 0xffffffff
        category = 'Missing DLL/runtime dependency' if code in {0xc0000135, 0xc000007b, 0xc0000142} else 'llama-server launch failure'
        detail = (result.stderr or result.stdout).decode('utf-8', errors='replace')[-1500:]
        raise BackendConfigurationError(f'{category} (exit {result.returncode}). Keep the complete official package together. {detail}')
    return path


def runtime_status():
    from .local_runtime import local_config
    from .backends.llama_cpp_process import get_process_manager
    server = get_process_manager().status_snapshot()
    settings = local_config()['local_llama_cpp']
    try:
        path = discover_server(settings.get('llama_server'), settings.get('runtime_root'))
        source = 'Override' if settings.get('llama_server') and str(settings['llama_server']).upper() != 'AUTO' else ('Managed' if path == active_server() else 'External / Legacy')
        return {'available': True, 'path': str(path), 'source': source, 'override': settings.get('llama_server') or 'AUTO', 'installation': installation_status(), 'variants': load_manifest()['runtimes'], 'server': server}
    except BackendConfigurationError as exc:
        return {'available': False, 'path': '', 'override': settings.get('llama_server') or 'AUTO', 'error': str(exc), 'source': 'Not Installed', 'installation': installation_status(), 'variants': load_manifest()['runtimes'], 'server': server}


def save_override(value):
    value = str(value or '').strip()
    with _LOCK:
        chosen = '' if value.upper() in {'', 'AUTO'} else str(validate_server(portable_path(value)))
        config = load_config()
        config['local_llama_cpp'] = {**config.get('local_llama_cpp', {}), 'llama_server': chosen}
        target = resolve_config_path()
        if not target.exists() and not os.environ.get('KOO_PROMPTER11_CONFIG'):
            target = _user_config_path() or target
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=target.parent, suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(config, stream, indent=2)
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return runtime_status()


def browse_servers(directory=''):
    from .gguf_browser import browse_gguf
    if not directory:
        return browse_gguf('')
    path = Path(directory).expanduser()
    if not path.is_absolute():
        raise BackendConfigurationError('Choose an absolute folder on the ComfyUI computer.')
    if path.is_file():
        path = path.parent
    try:
        entries = [{'name': p.name, 'path': str(p), 'directory': p.is_dir()} for p in path.iterdir()
                   if p.is_dir() or p.name.lower() in {'llama-server.exe', 'llama-server'}]
    except OSError as exc:
        raise BackendConfigurationError(f'Cannot open folder: {exc}') from exc
    return {'directory': str(path), 'parent': str(path.parent) if path.parent != path else '',
            'entries': sorted(entries, key=lambda p: (not p['directory'], p['name'].lower()))}

