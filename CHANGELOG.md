# Changelog

## 1.2.0 — release candidate, unpublished

- Finalize KoO Open Customisation License v1.0 licensing and clean RC distribution; record the Nodes 2.0 canvas compatibility blocker.

- Pin optional managed llama.cpp to official b10516 CPU, CUDA 12.4 plus companion DLLs, and Vulkan distributions.
- Require SHA256 and size verification before safe extraction; never run binaries during installation.
- Store new runtimes in namespaced ComfyUI user data; preserve override, legacy and external discovery.
- Add explicit variant selection, installation progress, repair and managed-only removal.
- Add optional Ollama status refresh and official installation help.
- Prepare Registry metadata and guarded manual publishing workflow.
- Preserve KoOApesPrompter11, all workflow-facing names, provider behavior and existing interactions.

# 1.1.1

- Fixed local llama.cpp runtime discovery.
- Added managed local llama.cpp installation from official releases.
- Added validated manual llama-server override and AUTO selection.
- Improved Portable / Stability Matrix path handling.
- Improved local_llama_cpp errors for missing runtime, DLLs, startup, GGUF and mmproj.
- Added consistent button hover, press, focus and disabled feedback.
- Added busy/loading interaction states and duplicate action guards.

Runtime packages: https://github.com/ggml-org/llama.cpp/releases
