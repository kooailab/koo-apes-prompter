"""Read-only GGUF selection on the ComfyUI host; never transfers model data."""
import os
from pathlib import Path

from .backends.base import BackendConfigurationError


def validate_gguf(value):
    path = Path(str(value or "")).expanduser()
    if not path.is_absolute():
        raise BackendConfigurationError("Select an absolute GGUF path on the ComfyUI computer.")
    if path.suffix.lower() != ".gguf":
        raise BackendConfigurationError("Select a .gguf file.")
    try:
        path = path.resolve(strict=True)
        if not path.is_file():
            raise BackendConfigurationError("Select a GGUF file, not a folder.")
        with path.open("rb") as stream:
            if stream.read(4) != b"GGUF":
                raise BackendConfigurationError(f"Not a valid GGUF file: {path.name}. Select a complete GGUF model.")
    except BackendConfigurationError:
        raise
    except FileNotFoundError as exc:
        raise BackendConfigurationError(f"Selected GGUF no longer exists: {path}. Browse to its new location.") from exc
    except (OSError, RuntimeError) as exc:
        raise BackendConfigurationError(f"Cannot read selected GGUF: {path}. Check file permissions and drive availability.") from exc
    return path


def select_gguf(model, mmproj="", supports_images=True):
    path = validate_gguf(model)
    if "mmproj" in path.name.casefold():
        raise BackendConfigurationError("Select the main model GGUF; choose its mmproj separately.")
    projector = validate_gguf(mmproj) if mmproj else None
    if projector and (projector == path or "mmproj" not in projector.name.casefold() or projector.parent != path.parent):
        raise BackendConfigurationError("Choose the matching mmproj GGUF from the same folder as the model.")
    if supports_images and projector is None:
        raise BackendConfigurationError("Text model found. Vision unavailable because the matching mmproj GGUF is missing. Select its matching projector or disable Use images.")
    return {"path": str(path), "name": path.name, "mmproj": str(projector) if projector else ""}


def browse_gguf(directory=""):
    if not directory:
        roots = [str(Path(f"{letter}:/")) for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if Path(f"{letter}:/").is_dir()] if os.name == "nt" else ["/"]
        return {"directory": "", "parent": "", "entries": [{"name": root, "path": root, "directory": True} for root in roots]}
    path = Path(str(directory)).expanduser()
    if not path.is_absolute():
        raise BackendConfigurationError("Enter an absolute folder path on the ComfyUI computer.")
    try:
        path = path.resolve(strict=True)
        if path.is_file():
            path = path.parent
        entries = []
        with os.scandir(path) as children:
            for child in children:
                try:
                    folder = child.is_dir()
                    if folder or (child.is_file() and Path(child.name).suffix.lower() == ".gguf"):
                        entries.append({"name": child.name, "path": child.path, "directory": folder})
                except OSError:
                    continue
        entries.sort(key=lambda item: (not item["directory"], item["name"].casefold()))
        return {"directory": str(path), "parent": str(path.parent) if path.parent != path else "", "entries": entries}
    except (OSError, RuntimeError) as exc:
        raise BackendConfigurationError(f"Cannot open folder: {path}. Check the path, permissions and drive availability.") from exc
