"""Explicit, pinned, verified runtime installation; never runs downloaded code."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import tarfile
import tempfile
import threading
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import zipfile

from .backends.base import BackendConfigurationError
from .portable_paths import comfy_root

MANIFEST_PATH = Path(__file__).resolve().parents[2] / 'runtime_manifest.json'
_LOCK = threading.Lock()
_STATUS_LOCK = threading.Lock()
_STATUS = {'phase': 'idle', 'downloaded': 0, 'total': 0, 'message': ''}
_MARKER = '.apes-runtime.json'


def managed_directory():
    try:
        import folder_paths
        getter = getattr(folder_paths, 'get_user_directory', None)
        if callable(getter):
            return Path(getter()).resolve() / 'KoO_Apes_Prompter/runtimes/llama.cpp'
    except (ImportError, AttributeError, OSError):
        pass
    root = comfy_root()
    if root is None:
        raise BackendConfigurationError('Cannot locate ComfyUI user data. Open Apes inside ComfyUI.')
    return root / 'user/KoO_Apes_Prompter/runtimes/llama.cpp'


def load_manifest():
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
        if data['schema_version'] != 1 or not data['runtimes']:
            raise ValueError('Invalid manifest schema')
        ids = set()
        for entry in data['runtimes']:
            for key in ('id', 'version'):
                if not re.fullmatch(r'[A-Za-z0-9_-]+', entry[key]):
                    raise ValueError('Invalid runtime identifier')
            if entry['id'] in ids or entry['executable'] not in {'llama-server.exe', 'llama-server'}:
                raise ValueError('Invalid runtime entry')
            ids.add(entry['id'])
            if not entry['artifacts']:
                raise ValueError('Missing artifacts')
            for artifact in entry['artifacts']:
                expected = 'https://github.com/ggml-org/llama.cpp/releases/download/' + entry['version'] + '/'
                url = artifact['url']
                if (not url.startswith(expected) or urlsplit(url).query or urlsplit(url).fragment
                        or url[len(expected):] != artifact['filename']
                        or '/' in artifact['filename'] or '\\' in artifact['filename']
                        or not re.fullmatch(r'[a-f0-9]{64}', artifact['sha256'])
                        or artifact['size'] <= 0 or artifact['archive'] not in {'zip', 'tar'}):
                    raise ValueError('Invalid pinned artifact')
        return data
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise BackendConfigurationError('Bundled runtime manifest is invalid; reinstall Apes.') from exc


def _progress(**values):
    with _STATUS_LOCK:
        _STATUS.update(values)


def installation_status():
    with _STATUS_LOCK:
        return dict(_STATUS)


def _entry(variant):
    entries = load_manifest()['runtimes']
    if variant == 'auto':
        raise BackendConfigurationError('Choose CPU, CUDA or Vulkan explicitly; Apes does not guess hardware support.')
    for entry in entries:
        if entry['id'] == variant and entry.get('enabled', True):
            return entry
    raise BackendConfigurationError('Select a supported runtime variant from the bundled manifest.')


def _target(entry):
    base = managed_directory()
    if any(path.is_symlink() or (getattr(path, 'is_junction', lambda: False)()) for path in (base, base.parent, base.parent.parent, base.parent.parent.parent)):
        raise BackendConfigurationError('Managed runtime storage cannot be a symlink or junction.')
    root = base.resolve()
    target = root / entry['version'] / entry['id']
    if not target.resolve().is_relative_to(root) or target.is_symlink():
        raise BackendConfigurationError('Managed runtime path escapes Apes user data.')
    return target


def active_server():
    root = managed_directory()
    active = root / 'active.json'
    if not active.is_file():
        return None
    try:
        entry = _entry(json.loads(active.read_text(encoding='utf-8'))['variant'])
        target = _target(entry)
        marker = json.loads((target / _MARKER).read_text(encoding='utf-8'))
        server = target / entry['executable']
        if marker.get('owner') == 'KoO_Apes_Prompter' and marker.get('variant') == entry['id'] and server.is_file():
            return server.resolve()
    except (OSError, ValueError, KeyError, BackendConfigurationError):
        pass
    return None


def _trusted_download_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}
            or parsed.username or parsed.password or parsed.port not in {None, 443}):
        raise BackendConfigurationError('Unexpected runtime download redirect.')


class OfficialReleaseRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        _trusted_download_url(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def _fetch(url):
    _trusted_download_url(url)
    return build_opener(OfficialReleaseRedirect()).open(Request(url, headers={'User-Agent': 'KoO-Apes-Prompter/1.2.0'}), timeout=30)


def download_artifact(artifact, archive, offset=0):
    digest = hashlib.sha256()
    written = 0
    with _fetch(artifact['url']) as response, Path(archive).open('wb') as output:
        _trusted_download_url(response.geturl())
        while chunk := response.read(1024 * 1024):
            written += len(chunk)
            if written > artifact['size']:
                raise BackendConfigurationError('Runtime download exceeds the pinned size.')
            output.write(chunk)
            digest.update(chunk)
            _progress(downloaded=offset + written)
    if written != artifact['size'] or digest.hexdigest() != artifact['sha256']:
        raise BackendConfigurationError('Runtime SHA256/size verification failed. Nothing was installed.')


def _safe_member(name, destination):
    normalized = name.replace('\\', '/')
    parts = PurePosixPath(normalized).parts
    reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
    if (not parts or normalized.startswith('/') or '..' in parts or ':' in normalized
            or any(part.rstrip(' .') != part or part.split('.')[0].upper() in reserved for part in parts)):
        raise BackendConfigurationError('Unsafe path in runtime archive.')
    target = destination.joinpath(*parts)
    if not target.resolve().is_relative_to(destination.resolve()):
        raise BackendConfigurationError('Unsafe path in runtime archive.')
    return target


def extract_safe(archive, destination, archive_type='zip'):
    destination = Path(destination)
    # Refuse links, devices, traversal and ambiguous names before extracting anything.
    if archive_type == 'zip':
        with zipfile.ZipFile(archive) as package:
            seen = set()
            total = 0
            for member in package.infolist():
                target = _safe_member(member.filename, destination)
                mode = (member.external_attr >> 16) & 0o170000
                if mode not in {0, 0o100000, 0o040000} or str(target).casefold() in seen:
                    raise BackendConfigurationError('Unsafe/duplicate member in runtime archive.')
                seen.add(str(target).casefold())
                total += member.file_size
                if total > 8 * 1024**3:
                    raise BackendConfigurationError('Runtime archive expands beyond the supported limit.')
            for member in package.infolist():
                target = _safe_member(member.filename, destination)
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with package.open(member) as source, target.open('xb') as output:
                        shutil.copyfileobj(source, output)
    elif archive_type == 'tar':
        with tarfile.open(archive) as package:
            seen = set()
            total = 0
            members = package.getmembers()
            for member in members:
                target = _safe_member(member.name, destination)
                total += member.size
                if not (member.isfile() or member.isdir()) or str(target).casefold() in seen or total > 8 * 1024**3:
                    raise BackendConfigurationError('Unsafe member in runtime archive.')
                seen.add(str(target).casefold())
            for member in members:
                target = _safe_member(member.name, destination)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with package.extractfile(member) as source, target.open('xb') as output:
                        shutil.copyfileobj(source, output)
    else:
        raise BackendConfigurationError('Unsupported archive type.')


def _mutation(target):
    # Serialize commit/removal with server startup and stop only idle owned users of this runtime.
    from .backends.llama_cpp_process import get_process_manager
    return get_process_manager().runtime_change(target)


def _assert_owned(target):
    try:
        marker = json.loads((target / _MARKER).read_text(encoding='utf-8'))
        if marker.get('owner') != 'KoO_Apes_Prompter':
            raise ValueError()
    except (ValueError, OSError):
        raise BackendConfigurationError('Refusing to modify an unmarked runtime folder.') from None


def _write_active(root, variant):
    fd, path = tempfile.mkstemp(prefix='.active-', dir=root)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump({'variant': variant}, output)
        os.replace(path, root / 'active.json')
    finally:
        Path(path).unlink(missing_ok=True)


def install_runtime(variant='windows-x64-cpu', repair=False):
    if not _LOCK.acquire(blocking=False):
        raise BackendConfigurationError('Runtime installation/removal already in progress.')
    try:
        entry = _entry(variant)
        if platform.system().lower() != entry['os'] or platform.machine().lower() not in {'amd64', 'x86_64'}:
            raise BackendConfigurationError('Managed installation supports Windows x64. Select an external runtime on this system.')
        target = _target(entry)
        root = managed_directory()
        if target.exists():
            _assert_owned(target)
            if not repair and (target / entry['executable']).is_file():
                _write_active(root, variant)
                from .managed_runtime import runtime_status
                return runtime_status()
        root.mkdir(parents=True, exist_ok=True)
        total = sum(a['size'] for a in entry['artifacts'])
        _progress(phase='downloading', downloaded=0, total=total, message=entry['display_name'])
        with tempfile.TemporaryDirectory(prefix='.apes-install-', dir=root) as temporary:
            work = Path(temporary)
            stage = work / 'runtime'
            stage.mkdir()
            offset = 0
            for index, artifact in enumerate(entry['artifacts']):
                archive = work / f'package-{index}'
                download_artifact(artifact, archive, offset)
                _progress(phase='extracting', message='SHA256 verified; extracting ' + artifact['filename'])
                extract_safe(archive, stage, artifact['archive'])
                offset += artifact['size']
                _progress(phase='downloading')
            servers = list(stage.rglob(entry['executable']))
            if len(servers) != 1:
                raise BackendConfigurationError('Runtime archive must contain exactly one llama-server.')
            if servers[0].parent != stage:
                raise BackendConfigurationError('Unexpected official archive layout; select an external runtime.')
            (stage / _MARKER).write_text(json.dumps({'owner': 'KoO_Apes_Prompter', 'variant': variant,
                'version': entry['version'], 'artifacts': entry['artifacts']}), encoding='utf-8')
            _progress(phase='installing', message='Committing verified runtime')
            with _mutation(target):
                backup = work / 'previous'
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    _assert_owned(target)
                    target.rename(backup)
                try:
                    stage.rename(target)
                    _write_active(root, variant)
                except BaseException:
                    if target.exists():
                        shutil.rmtree(target)
                    if backup.exists():
                        backup.rename(target)
                    raise
        _progress(phase='complete', downloaded=total, message='Installed; executable was not run. Select a model to generate.')
        from .managed_runtime import runtime_status
        return runtime_status()
    except Exception as exc:
        _progress(phase='failed', message=str(exc))
        if isinstance(exc, BackendConfigurationError):
            raise
        raise BackendConfigurationError('Runtime installation failed; temporary downloads cleaned. ' + str(exc)) from exc
    finally:
        _LOCK.release()


def remove_runtime(variant='windows-x64-cpu'):
    if not _LOCK.acquire(blocking=False):
        raise BackendConfigurationError('Runtime installation/removal already in progress.')
    try:
        entry = _entry(variant)
        target = _target(entry)
        if target.exists():
            _assert_owned(target)
            with _mutation(target):
                shutil.rmtree(target)
        active = managed_directory() / 'active.json'
        if active.is_file() and json.loads(active.read_text(encoding='utf-8')).get('variant') == variant:
            active.unlink()
        _progress(phase='idle', downloaded=0, total=0, message='Managed variant removed; external runtimes were untouched.')
        from .managed_runtime import runtime_status
        return runtime_status()
    finally:
        _LOCK.release()
