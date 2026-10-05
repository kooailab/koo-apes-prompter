# KoO Apes Prompter

An independent prompt director for text and image references, with optional llama.cpp/GGUF, Ollama and OpenAI-compatible providers. It supports provider switching, model selection, two-image reference controls, Director presets, text generation and vision generation. KoO Nodes Pack is not required.

Version **1.2.0**, GitHub source release; Registry publication pending. The workflow ID remains `KoOApesPrompter11` and the display name remains **KoO Apes Prompter 1.1** for saved-workflow compatibility. Licensed under the KoO Open Customisation License v1.0, Copyright (c) 2026 KoO.Ai. See [LICENSE](LICENSE). Registry publisher: **KoO.Ai** (`koo-ai`). GitHub repository: [koo-apes-prompter](https://github.com/kevintronchin-blip/koo-apes-prompter).

## Install Apes

1. Download the source ZIP from [koo-apes-prompter](https://github.com/kevintronchin-blip/koo-apes-prompter).
2. Extract it as `ComfyUI/custom_nodes/koo-apes-prompter`, with `__init__.py` directly inside that folder.
3. Install missing declared dependencies using ComfyUI's Python environment, restart ComfyUI, and refresh the browser.
4. Add **KoO Apes Prompter 1.1** from the KoO category.

Regular Python/venv ComfyUI, from this node folder:

```sh
python -m pip install -r requirements.txt
```

Windows portable, from the portable root:

```bat
python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\koo-apes-prompter\requirements.txt
```

`aiohttp` and `Pillow` are the only declared Python dependencies and are normally already in ComfyUI. There is no Python llama.cpp, Ollama or OpenAI SDK requirement. The plugin performs no runtime pip installation.

After publication, Manager/Registry installation can use the package ID `koo-apes-prompter`. That ID has not been registered or reserved. Keep only one installed copy of this project.

## First run and providers

Apes loads without any AI backend installed. There is no startup wizard, automatic download or modal prompt. Choose the provider in **LLM ENGINE** when you want to generate, then open Advanced settings for backend status and setup. Missing capabilities produce a feature-specific error when selected.

| Configuration | What you need |
| --- | --- |
| No backend | Plugin/UI loads; generation needs a provider |
| Ollama only | Running Ollama and a selected installed model |
| External llama.cpp only | Complete llama-server distribution and your GGUF model |
| Apes-managed llama.cpp only | Explicit runtime installation and your GGUF model |
| Custom API only | Reachable OpenAI-compatible endpoint and model; key if required |

The common provider layer retains native Ollama and OpenAI-compatible transports. The local bridge retains the existing llama.cpp process manager and visual director pipeline. Provider-specific external applications are never imported as Python dependencies during startup. The runtime installer is isolated in `runtime_installer.py` and uses only the bundled manifest.

## Ollama

Ollama is an optional external application. Choose **Ollama Native**, normally at `http://127.0.0.1:11434`, then use **Refresh Models** and select an installed model. Select a vision-capable model when using image references.

Advanced settings show **Detected / Not Detected** after **Refresh**. **Installation Help** opens the [official Ollama download page](https://ollama.com/download). Apes never installs or bundles Ollama. Ollama works without llama.cpp.

## Managed llama.cpp runtime

Open Advanced engine settings or the runtime button, choose **CPU**, **CUDA 12.4** or **Vulkan**, and click **Install Local llama.cpp Runtime**. CPU is the explicit default. Choose CUDA only with a suitable NVIDIA driver (551.61 or newer for this pinned distribution), or Vulkan with a compatible driver. Apes does not guess hardware support.

The bundled `runtime_manifest.json` pins official [ggml-org/llama.cpp build b10516](https://github.com/ggml-org/llama.cpp/releases/tag/b10516). It records archive URLs, SHA256 values, sizes, platform, architecture, backend and expected executable. CUDA includes a separately verified companion DLL archive. Installation never queries `latest` and never executes the downloaded executable. Future runtime changes require an Apes manifest update.

Downloads begin only after your installation/repair click. The UI shows phase and downloaded bytes. Apes requires HTTPS, verifies SHA256 and size before extraction, rejects traversal, links and ambiguous archive names, stages changes and cleans failed temporary downloads. It never changes PATH, installs Python packages, or asks for Administrator rights.

New runtime storage is resolved with `folder_paths.get_user_directory()` where available:

```text
ComfyUI/user/KoO_Apes_Prompter/runtimes/llama.cpp/
  b10516/
    windows-x64-cpu/
    windows-x64-cuda12/
    windows-x64-vulkan/
  active.json
```

A relocated ComfyUI user directory is respected. On older ComfyUI builds the fallback is `<ComfyUI root>/user`. Runtimes and models are excluded from both Git and Registry archives. Managed installation is currently offered for Windows x64; other systems can use an external llama-server, Ollama or a custom API.

**Repair selected managed variant** downloads and verifies that variant again and replaces only an Apes-marked directory. Failed downloads preserve an existing installation. **Remove selected managed variant** removes only that new Apes-owned variant, never manual overrides or legacy/external installations. Removal/repair refuses an active generation using that runtime and unloads an idle owned server when necessary. Removing the active variant clears its active selection; AUTO discovery may then find a legacy/external server.

## External llama.cpp and discovery order

If you already have a working llama.cpp distribution, use **Select External llama-server** or configure `local_llama_cpp.llama_server`. Keep the complete distribution and its DLLs together; no second download is required. Selecting an override explicitly validates it using `llama-server --version`; this is separate from installation, which executes nothing.

Discovery priority:

1. Explicit override (an invalid override returns an error instead of silently falling back).
2. Active new Apes-managed variant from user data.
3. Legacy `ComfyUI/tools/ApesPrompter/llama.cpp`.
4. Configured `runtime_root`.
5. Existing `ComfyUI/tools/KoO/llama.cpp` and ComfyUI root locations.
6. `llama-server.exe` / `llama-server` on PATH.

**AUTO discovery** clears the explicit override and resumes this order. Existing runtimes are not moved or deleted. The optional legacy Visual Prompt Director configuration is read for local runtime compatibility only; Apes remains usable without KoO Nodes Pack, and provider credentials are never inherited from it.

## GGUF models and images

No model is bundled or automatically downloaded. Existing discovery scans `ComfyUI/models/LLM`; model + matching mmproj folders remain supported. Use **Refresh Models** after adding files, or **Browse GGUF** to select an external model. Absolute, relative ComfyUI paths, spaces and Unicode paths remain supported.

For image references, select a vision-capable model and its compatible mmproj. A text-only model can be used with image support disabled. Browse transfers paths only; it does not upload or modify GGUF files. The local runtime, model and override controls require ComfyUI opened on its computer through localhost. Normal provider generation retains the existing remote usage.

Basic flow: choose a provider/model, write an idea, select Mode and Target Model, click **Generate**, and connect the resulting STRING to a text encoder. For vision, connect IMAGE / IMAGE 2 and queue the node. The image-reference and Director controls retain their existing behavior. Button hover/press/focus/busy states and duplicate action guards are preserved.

## Custom API

Choose **Custom OpenAI Compatible**, LM Studio, vLLM, LocalAI or OpenRouter. Set the base endpoint in Advanced, refresh the model list and test the connection. The server must expose compatible model and chat-completion endpoints. Image support depends on the selected server/model.

Enter API keys in the session-only Advanced credential control. Keys are stored in server memory, scoped by provider and normalized endpoint, and are not saved to workflows or localStorage. Alternatively, use matching environment variables `KOO_PROMPTER11_API_BASE_URL` and `KOO_PROMPTER11_API_KEY`. No key is included in example configs, logs or source.

## Configuration and troubleshooting

The existing `KOO_PROMPTER11_CONFIG` override is retained. Apes reads its user config under `KoO/apes_prompter11/config.json` and retains the legacy package-local fallback. Copy `config.example.json` only if manual configuration is needed; user configuration is excluded from Git and Registry packaging.

- **No backend detected:** choose Ollama, an existing external runtime, explicit managed setup or your API endpoint. ComfyUI startup remains unaffected.
- **Invalid GGUF/mmproj:** check the selected files, model/server compatibility and exact vision pairing.
- **Missing DLL / exit code:** retain the whole runtime distribution. Use repair for a managed variant or select a complete external distribution.
- **Port occupied:** the existing manager chooses a free loopback fallback port and logs it; it does not terminate another application's server.
- **Startup timeout / premature exit:** inspect the ComfyUI console and recent llama-server stderr in runtime status; check available RAM/VRAM, model compatibility and driver support.
- **Hash mismatch / interrupted download:** temporary downloads are cleaned. Retry install/repair. Never bypass hash verification.
- **Busy runtime:** wait for generation to finish before repairing/removing it. One owned llama-server is reused and unloaded through existing lifecycle controls.
- **Frontend not refreshed:** restart ComfyUI, refresh the browser and inspect its console.

## Update and release preparation

Pull this project's Git repository or replace its source from a new ZIP, install changed requirements with ComfyUI's Python, restart ComfyUI and refresh the browser. Preserve ComfyUI user data and legacy private config. Do not install another copy beside the existing one, because both would register the same workflow ID.

See [CHANGELOG.md](CHANGELOG.md) and [RELEASE_TODO.md](RELEASE_TODO.md). The publishing workflow is manual-only and refuses placeholder publisher and repository metadata. It expects `REGISTRY_ACCESS_TOKEN` in GitHub secrets. Registry publication is pending; see RELEASE_TODO.md.

## Frontend qualification

The current custom canvas interface requires the Legacy / LiteGraph renderer.
In ComfyUI frontend 1.51.10, Nodes 2.0 skips node-level canvas drawing and mouse
hooks used by this project. Nodes 2.0 compatibility is blocked pending a focused
frontend adaptation and real browser qualification. Backend registration and
automated frontend tests do not certify rendering, DPI layout or interaction.
The same RC is supplied for both renderers; no alternate build or V3 migration
has been made. Complete the manual checklist in the accompanying release report
before a public release.

## Attribution and customised editions

Original product by **KoO.Ai**: https://youtube.com/@kooai-o9t. Personal and commercial use, modifications, forks and redistribution are permitted under LICENSE. Modified editions must keep the original KoO product name, append their own edition name, retain attribution and the channel link, and clearly identify themselves as unofficial.
