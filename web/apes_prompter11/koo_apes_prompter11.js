import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  DEFAULT_ACCENT,
  SWATCHES,
  THEMES,
  THEME_TOKENS,
  activeFill,
  activeForeground,
  buildAccentPalette,
  drawPaletteIcon,
  drawRound,
  drawText,
  ellipsize,
  hexToRgba,
  normalizeHex,
} from "../resolution_next/koo_ui_shared.js";

const NODE_NAME = "KoOApesPrompter11";
const ROUTE = "/koo/prompter11/v1/generate";
const TEXT_ROUTE = "/koo/prompter11/v1/generate-text";
const MODELS_ROUTE = "/koo/prompter11/v1/models";
const PRESETS_ROUTE = "/koo/prompter11/v1/presets";
const UNLOAD_ROUTE = "/koo/prompter11/v1/unload";
const RUNTIMES = ["LLAMA.CPP", "OLLAMA"];
const DEFAULT_OLLAMA_MODEL = "qwen3.8";
const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434/v1";
const MODES = ["Enhance", "Archviz", "Photography", "Character", "Product", "Image Edit", "Style Transfer", "Dataset Caption", "Video", "Custom"];
const TARGETS = ["Generic", "Krea 2", "FLUX.2 Klein", "Z-Image", "Qwen Image", "MiniMax", "LTX 2.5"];
const CREATIVITY = ["Strict", "Balanced", "Creative", "Dice"];
const PROMPT_MODELS = ["Qwen 3.5 9B", "Qwen 3.5 9B — Uncensored", "Qwen 3.5 9B — HauhauCS Aggressive", "Gemma 3 12B", "Custom"];
const DIRECTOR_PRESETS = [
  "General Director", "Prompt Enhancer", "Reverse Engineer", "Surgical Edit",
  "Face Identity Analyst", "Subject Appearance Analyst", "Reference Composer",
  "Photography Director", "Smartphone Realism", "Arm's-Length Selfie", "Mirror Selfie",
  "First-Person POV", "Fashion Editorial", "Vintage / Analog", "Boudoir / Intimate",
  "Krea 2 High Detail", "Krea 2 Smartphone Realism", "Krea 2 Pose Lock",
  "Video Director", "MiniMax H3 Director", "Archviz Director", "Character Director",
  "Product Director", "Style Transfer Director", "Dataset Caption Director",
  "Maximum Detail Director",
];
const DEFAULT_DIRECTOR_PRESET = "General Director";
const WORKFLOW_RULES_HELP = "Extra rules applied to this specific workflow.";
const WORKFLOW_RULES_PLACEHOLDER = "Example: Always preserve the original pose and camera angle. Keep prompts under 150 words.";
const DIRECTOR_BEHAVIOR_HELP = "Defines how this reusable Director analyzes and writes prompts.";
const DIRECTOR_BEHAVIOR_PLACEHOLDER = "Example: You are an expert visual reverse engineer. Analyze pose, composition, camera, lighting and materials precisely. Preserve visible evidence and avoid invented details.";
const MODE_DIRECTORS = {
  Enhance: "General Director",
  Photography: "Photography Director",
  Archviz: "Archviz Director",
  Video: "Video Director",
  Product: "Product Director",
  Character: "Character Director",
  "Image Edit": "Surgical Edit",
  "Style Transfer": "Style Transfer Director",
  "Dataset Caption": "Dataset Caption Director",
  Custom: "General Director",
};
const LENGTHS = ["Short", "Medium", "Detailed", "Maximum Detail"];
const REFERENCE_SOURCES = ["Auto", "Image 1", "Image 2", "Blend"];
const REFERENCE_SOURCE_LABELS = { Auto: "AUTO", "Image 1": "IMG 1", "Image 2": "IMG 2", Blend: "BLEND" };
const REFERENCE_MAP_FIELDS = [
  ["reference_subject_source", "Subject"], ["reference_face_source", "Face / Identity"],
  ["reference_outfit_source", "Outfit"], ["reference_pose_source", "Pose"],
  ["reference_composition_source", "Composition"], ["reference_camera_source", "Camera"],
  ["reference_scene_source", "Scene / Env."], ["reference_lighting_source", "Lighting"],
  ["reference_colors_source", "Colors"], ["reference_mood_source", "Mood / Style"],
  ["reference_materials_source", "Materials"],
];
const ENGINE_DEFAULTS = {provider_preset: "Ollama Native", engine_model: "", base_url: "http://127.0.0.1:11434", timeout: 600, max_output_tokens: 8192, temperature: -1, top_p: -1, top_k: -1, sampling_nonce: -1, send_sampling: true, model_supports_images: true, token_field: "max_tokens"};
const ENGINE_FIELDS = Object.keys(ENGINE_DEFAULTS);
let enginePresets = {};
function engineState(node) { return Object.fromEntries(ENGINE_FIELDS.map(key => [key, value(node, key, ENGINE_DEFAULTS[key])])); }
async function engineApi(action, data) {
  const response = await api.fetchApi(`/koo/prompter11/v1/${action}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Provider request failed");
  return result;
}
async function loadEnginePresets() {
  const response = await api.fetchApi("/koo/prompter11/v1/engine-presets");
  const data = await response.json();
  if (response.ok && data.ok) enginePresets = data.presets;
}
function invalidateEngine(node) {
  node._kooPrompter11Discovery = null;
  node._kooPrompter11Connection = "Disconnected — test connection";
  node._kooPrompter11ModelsRequestId = (node._kooPrompter11ModelsRequestId || 0) + 1;
  node._kooPrompter11ModelsLoading = false;
}
async function testConnection(node) {
  const current = engineState(node);
  const identity = JSON.stringify(current);
  node._kooPrompter11Connection = "Testing connection...";
  node.setDirtyCanvas(true, true);
  try {
    const result = await engineApi("test-connection", {...current, director_mmproj_path: value(node, "director_mmproj_path", "")});
    if (JSON.stringify(engineState(node)) !== identity) return;
    node._kooPrompter11Connection = `Connected — ${result.message}`;
  } catch (error) {
    if (JSON.stringify(engineState(node)) !== identity) return;
    node._kooPrompter11Connection = `Failed — ${error.message}`;
  }
  node.setDirtyCanvas(true, true);
}
function engineDialog(node) {
  const current = engineState(node);
  const overlay = document.createElement("div"); overlay.classList.add("apes-dialog");
  overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:#0009;display:grid;place-items:center";
  const panel = document.createElement("form");
  panel.style.cssText = "background:#202127;color:#eee;padding:24px;border-radius:12px;width:500px;max-height:85vh;overflow:auto;font:14px system-ui";
  const heading = document.createElement("h3"); heading.textContent = "KoO Apes Prompter 1.1 — Advanced engine settings"; panel.append(heading);
  const inputs = {};
  const labels = {base_url: "Base URL", timeout: "Timeout (seconds)", max_output_tokens: "Max Output Tokens", temperature: "Temperature (−1: automatic)", top_p: "Top P (−1: server default)", top_k: "Top K (−1: automatic)", sampling_nonce: "Seed (−1: random)", send_sampling: "Send optional sampling controls", model_supports_images: "Selected model supports images", token_field: "Output token parameter"};
  const capabilities = enginePresets[current.provider_preset]?.capabilities || {};
  const local = current.provider_preset === "llama.cpp";
  addRuntimeControls(node, panel);
  addOllamaControls(node, panel);
  if (local) labels.base_url = "Endpoint (managed automatically)";
  for (const [key, label] of Object.entries(labels)) {
    const row = document.createElement("label"); row.style.cssText = "display:flex;justify-content:space-between;gap:16px;align-items:center;margin:12px 0";
    const text = document.createElement("span"); text.textContent = label; row.append(text);
    const input = document.createElement(key === "token_field" ? "select" : "input");
    if (key === "token_field") {
      for (const item of ["max_tokens", "max_completion_tokens"]) { const option = document.createElement("option"); option.value = item; option.textContent = item; input.append(option); }
      input.value = current[key];
      input.disabled = enginePresets[current.provider_preset]?.provider === "ollama_native";
    } else if (typeof current[key] === "boolean") { input.type = "checkbox"; input.checked = current[key]; }
    else { input.type = typeof current[key] === "number" ? "number" : "text"; input.value = current[key]; input.step = "any"; }
    if (key === "top_k" && !capabilities.supports_top_k) input.disabled = true;
    if (local && ["base_url", "top_p", "sampling_nonce", "send_sampling", "token_field"].includes(key)) input.disabled = true;
    input.style.cssText = "max-width:250px;padding:6px"; inputs[key] = input; row.append(input); panel.append(row);
  }
  const keyRow = document.createElement("label"); keyRow.textContent = "API key (server session only) ";
  const secretInput = document.createElement("input"); secretInput.type = "password"; secretInput.autocomplete = "off"; secretInput.placeholder = "Leave blank to keep current key"; keyRow.append(secretInput); panel.append(keyRow);
  const note = document.createElement("p"); note.textContent = "Keys are scoped to this provider and endpoint, and cleared when ComfyUI exits. They are never saved in workflows. Disable optional sampling for servers that reject it. Image support also depends on the selected model."; panel.append(note);
  if (local) {
    keyRow.hidden = true;
    note.textContent = "Uses local GGUF models and the Llama Server settings above. Vision requires the matching mmproj. Generate starts the server automatically and reuses it until the model changes or you unload it.";
  }
  const status = document.createElement("p"); panel.append(status);
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "Save";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
  const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "Clear session key";
  clear.hidden = local;
  const close = () => { secretInput.value = ""; overlay.remove(); };
  cancel.onclick = close;
  clear.onclick = async () => { clear.disabled = true; clear.textContent = "Clearing..."; try { await engineApi("credentials", {...current, api_key: ""}); status.textContent = "Session key cleared."; } catch { status.textContent = "Could not clear the key."; } finally { clear.disabled = false; clear.textContent = "Clear session key"; } };
  panel.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true; save.textContent = "Saving...";
    const next = {...current};
    for (const [key, input] of Object.entries(inputs)) next[key] = typeof current[key] === "boolean" ? input.checked : typeof current[key] === "number" ? Number(input.value) : input.value.trim();
    try {
      const url = new URL(next.base_url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use an HTTP(S) base URL without credentials or query parameters.");
      if (secretInput.value) await engineApi("credentials", {...next, api_key: secretInput.value});
      for (const key of ENGINE_FIELDS) setValue(node, key, next[key]);
      invalidateEngine(node); close();
    } catch (error) { status.textContent = error.message || "Could not save settings."; }
    finally { save.disabled = false; save.textContent = "Save"; }
  };
  panel.append(save, cancel, clear); overlay.append(panel); document.body.append(overlay);
}

function manualModels(node) { return node.properties.kooPrompter11ManualModels || {}; }
function localModelLabel(model) { return String(model || "").split(/[\\/]/).pop(); }
function browseGGUF(node) {
  if (value(node, "provider_preset") !== "llama.cpp" || node._kooGGUFBrowser) return;
  const identity = JSON.stringify(engineState(node));
  const t = THEME_TOKENS[node.properties.kooPrompter11Theme] || THEME_TOKENS.Dark;
  const overlay = document.createElement("div"); overlay.classList.add("apes-dialog");
  overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:#0009;display:grid;place-items:center";
  const panel = document.createElement("form");
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Browse GGUF");
  panel.style.cssText = `background:${t.background};color:${t.text};padding:20px;border:1px solid ${t.border};border-radius:12px;width:min(680px,90vw);max-height:85vh;overflow:auto;font:14px system-ui`;
  const title = document.createElement("h3"); title.textContent = "📁 Browse GGUF";
  const note = document.createElement("p"); note.textContent = "Select an existing file on this ComfyUI computer. Nothing is uploaded or copied.";
  const directory = document.createElement("input"); directory.type = "text"; directory.placeholder = "Absolute folder or GGUF path"; directory.setAttribute("aria-label", "Folder or GGUF path");
  directory.style.cssText = "width:100%;box-sizing:border-box;padding:8px";
  const nav = document.createElement("div");
  const button = (label, action) => { const el = document.createElement("button"); el.type = "button"; el.textContent = label; el.onclick = async () => { if (el.disabled) return; el.disabled = true; el.textContent = "Working..."; try { await action(); } finally { el.disabled = false; el.textContent = label; } }; el.style.cssText = `padding:7px 12px;margin:4px;border:1px solid ${t.border};border-radius:6px;background:${t.surfaceRaised};color:${t.text};cursor:pointer`; return el; };
  const list = document.createElement("div"); list.style.cssText = "height:240px;overflow:auto;display:flex;flex-direction:column;margin:8px 0";
  const selected = document.createElement("p"); selected.style.overflowWrap = "anywhere";
  const projector = document.createElement("select"); projector.setAttribute("aria-label", "Matching mmproj"); projector.style.maxWidth = "100%";
  const images = document.createElement("input"); images.type = "checkbox"; images.checked = Boolean(value(node, "model_supports_images", true));
  const imageLabel = document.createElement("label"); imageLabel.append(images, document.createTextNode(" Use images (requires matching mmproj); uncheck for Text only"));
  const warning = document.createElement("p"); warning.textContent = "For vision, choose the projector supplied for this model. Compatibility is not inferred from filenames.";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  let chosen = "", parent = "", entries = [], revision = 0, closed = false;
  const choose = (path) => {
    chosen = path; selected.textContent = path || "Select a model GGUF.";
    projector.replaceChildren();
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Select matching mmproj (none for text only)"; projector.append(empty);
    for (const item of entries.filter(item => !item.directory && /mmproj/i.test(item.name))) {
      const option = document.createElement("option"); option.value = item.path; option.textContent = item.name; projector.append(option);
    }
    const saved = manualModels(node)[path];
    if (saved) { projector.value = saved.mmproj || ""; images.checked = saved.images; }
  };
  const open = async (path) => {
    const ticket = ++revision; status.textContent = "Reading folder…";
    try {
      const data = await engineApi("browse-gguf", {...engineState(node), directory: path});
      if (closed || ticket !== revision) return;
      directory.value = data.directory; parent = data.parent; entries = data.entries;
      list.replaceChildren(); choose("");
      for (const item of entries) {
        const row = button(`${item.directory ? "📁" : "▤"} ${item.name}`, () => item.directory ? open(item.path) : choose(item.path));
        row.style.textAlign = "left"; row.style.flexShrink = "0"; row.title = item.path;
        row.disabled = !item.directory && /mmproj/i.test(item.name); list.append(row);
      }
      if (/\.gguf$/i.test(path)) choose(path);
      status.textContent = entries.length ? "" : "No folders or GGUF files here.";
    } catch (error) { if (!closed && ticket === revision) status.textContent = error.message; }
  };
  const close = () => { closed = true; node._kooGGUFBrowser = false; overlay.remove(); };
  nav.append(button("Open", () => open(directory.value)), button("Up", () => open(parent)), button("Drives / Root", () => open("")));
  directory.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); open(directory.value); } };
  panel.onkeydown = event => { if (event.key === "Escape") { event.preventDefault(); close(); } };
  const save = button("Use GGUF", async () => {
    save.disabled = true;
    try {
      const data = await engineApi("select-gguf", {...engineState(node), engine_model: chosen, director_mmproj_path: projector.value, model_supports_images: images.checked});
      if (closed) return;
      if (JSON.stringify(engineState(node)) !== identity) throw new Error("The provider or model changed. Close Browse and open it again.");
      node.properties.kooPrompter11ManualModels = {...manualModels(node), [data.path]: {mmproj: data.mmproj, images: images.checked}};
      setValue(node, "engine_model", data.path); setValue(node, "director_mmproj_path", data.mmproj); setValue(node, "model_supports_images", images.checked);
      node._kooPrompter11Connection = `Selected ${data.name} — starts on Generate`;
      close(); node.setDirtyCanvas(true, true);
    } catch (error) { if (!closed) status.textContent = error.message; }
    finally { save.disabled = false; save.textContent = "Save"; }
  });
  panel.onsubmit = event => event.preventDefault();
  panel.append(title, note, directory, nav, list, selected, projector, document.createElement("br"), imageLabel, warning, status, save, button("Cancel", close));
  overlay.append(panel); document.body.append(overlay); node._kooGGUFBrowser = true; directory.focus();
  const current = String(value(node, "engine_model", ""));
  open(/\.gguf$/i.test(current) ? current : "");
}

const WIDGET_NAMES = [
  ...ENGINE_FIELDS,
  "idea", "mode", "target_model", "creativity",
  "preserve_subject", "preserve_composition", "preserve_camera",
  "preserve_materials", "preserve_lighting", "preserve_colors",
  "prompt_length", "custom_instructions", "system_prompt_override", "generated_prompt",
  "prompt_model", "director_profile", "director_model_path", "director_mmproj_path",
  "director_llama_server", "director_context_size", "director_image_min_tokens",
  "director_max_tokens", "director_gpu_layers", "director_keep_model_loaded",
  "director_preset", "image_1_role", "image_2_role", "lock_generated_prompt",
  ...REFERENCE_MAP_FIELDS.map(([field]) => field),
  // Runtime fields are intentionally last so legacy widgets_values stay aligned.
  "runtime", "ollama_model", "ollama_endpoint",
];
const PRESERVE_FIELDS = [
  ["preserve_subject", "Subject"], ["preserve_composition", "Composition"],
  ["preserve_camera", "Camera"], ["preserve_materials", "Materials"],
  ["preserve_lighting", "Lighting"], ["preserve_colors", "Colors"],
];

function ensureProperties(node) {
  node.properties = node.properties || {};
  if (typeof node.properties.kooPrompter11AdvancedOpen !== "boolean") {
    node.properties.kooPrompter11AdvancedOpen = false;
  }
  if (typeof node.properties.kooPrompter11AppearanceOpen !== "boolean") {
    node.properties.kooPrompter11AppearanceOpen = false;
  }
  node.properties.kooPrompter11Theme = THEMES.includes(node.properties.kooPrompter11Theme)
    ? node.properties.kooPrompter11Theme : "Dark";
  node.properties.kooPrompter11Accent = normalizeHex(node.properties.kooPrompter11Accent) || DEFAULT_ACCENT;
  node.properties.kooPrompter11Contrast = Boolean(node.properties.kooPrompter11Contrast);
  node._kooPrompter11Status = node._kooPrompter11Status || { kind: "idle", message: "Ready" };
}

function hideWidget(item) {
  if (!item) return;
  item.hidden = true;
  item.options = item.options || {};
  item.options.hidden = true;
  item.computeSize = () => [0, 0];
  item.draw = () => {};
  if (item.element) item.element.style.display = "none";
  if (item.inputEl) item.inputEl.style.display = "none";
}

function detachWidgets(node, values) {
  const found = new Map();
  for (const item of [...(node._kooPrompter11Widgets || []), ...(node.widgets || [])]) {
    if (item?.name && WIDGET_NAMES.includes(item.name) && !found.has(item.name)) found.set(item.name, item);
  }
  node._kooPrompter11Widgets = WIDGET_NAMES.map((name) => found.get(name)).filter(Boolean);
  if (Array.isArray(values)) {
    WIDGET_NAMES.forEach((name, index) => {
      const item = found.get(name);
      if (item && values[index] !== undefined) item.value = values[index];
    });
  }
  node._kooPrompter11Widgets.forEach(hideWidget);
  const promptModel = found.get("prompt_model");
  if (promptModel) promptModel.value = normalizePromptModel(promptModel.value);
  const promptLength = found.get("prompt_length");
  if (promptLength) promptLength.value = normalizePromptLength(promptLength.value);
  const directorPreset = found.get("director_preset");
  const directorPresetIndex = WIDGET_NAMES.indexOf("director_preset");
  if (directorPreset && Array.isArray(values) && values.length <= directorPresetIndex) {
    directorPreset.value = legacyPresetForMode(found.get("mode")?.value);
  } else if (directorPreset) {
    directorPreset.value = normalizeDirectorPreset(directorPreset.value);
  }
}

function legacyPresetForMode(mode) {
  return MODE_DIRECTORS[String(mode || "")] || DEFAULT_DIRECTOR_PRESET;
}

function normalizeDirectorPreset(value) {
  const raw = String(value || "").trim();
  const aliases = {
    "Reference Reconstruction": "Reverse Engineer",
    "Creative Enhancement": "General Director",
    "Archviz Reconstruction": "Archviz Director",
    "Image Edit Director": "Surgical Edit",
  };
  return aliases[raw] || raw || DEFAULT_DIRECTOR_PRESET;
}

function normalizePromptModel(value) {
  const compact = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = {
    default: "Qwen 3.5 9B",
    qwen359b: "Qwen 3.5 9B",
    qwen359bstandard: "Qwen 3.5 9B",
    uncensored: "Qwen 3.5 9B — Uncensored",
    qwen359buncensored: "Qwen 3.5 9B — Uncensored",
    qwen359buncensoredhauhaucsaggressive: "Qwen 3.5 9B — HauhauCS Aggressive",
    qwen359bhauhaucsaggressive: "Qwen 3.5 9B — HauhauCS Aggressive",
    gemma: "Gemma 3 12B",
    gemma312b: "Gemma 3 12B",
    custom: "Custom",
  };
  return aliases[compact] || "Qwen 3.5 9B";
}

function normalizeRuntime(value) {
  return String(value || "").trim().toUpperCase() === "OLLAMA" ? "OLLAMA" : "LLAMA.CPP";
}

function widget(node, name) {
  return (node._kooPrompter11Widgets || node.widgets || []).find((item) => item?.name === name);
}

function value(node, name, fallback = "") {
  const item = widget(node, name);
  return item ? item.value : fallback;
}

function setStatus(node, kind, message) {
  node._kooPrompter11Status = { kind, message };
  node.setDirtyCanvas(true, true);
}

function setValue(node, name, next, invalidate = true) {
  const item = widget(node, name);
  if (!item) return;
  item.value = next;
  const generatedIsLocked = Boolean(value(node, "lock_generated_prompt", false));
  if (invalidate && name !== "generated_prompt" && name !== "lock_generated_prompt" && !generatedIsLocked) {
    const generated = widget(node, "generated_prompt");
    if (generated) generated.value = "";
    setStatus(node, "idle", "Settings changed — generate again");
  }
  node.setDirtyCanvas(true, true);
}

function promptFromExecution(message) {
  const payload = message?.generated_prompt;
  const prompt = Array.isArray(payload) ? payload[0] : payload;
  return typeof prompt === "string" ? prompt : null;
}

function normalizePromptLength(value) {
  const raw = String(value || "").trim();
  return raw === "Maximum" ? "Maximum Detail" : (LENGTHS.includes(raw) ? raw : "Medium");
}

function showCopyFeedback(node, label, kind, message) {
  const until = Date.now() + 1400;
  node._kooPrompter11CopyFeedback = { label, until };
  setStatus(node, kind, message);
  globalThis.setTimeout?.(() => {
    if (node._kooPrompter11CopyFeedback?.until !== until) return;
    delete node._kooPrompter11CopyFeedback;
    node.setDirtyCanvas(true, true);
  }, 1450);
}

async function copyGeneratedPrompt(node) {
  const prompt = String(value(node, "generated_prompt", ""));
  if (!prompt.trim()) {
    showCopyFeedback(node, "EMPTY", "idle", "Generated prompt is empty");
    return;
  }

  let copied = false;
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(prompt);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    let area = null;
    try {
      area = document.createElement("textarea");
      area.value = prompt;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(area);
      area.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      area?.remove();
    }
  }

  showCopyFeedback(
    node,
    copied ? "COPIED!" : "FAILED",
    copied ? "success" : "error",
    copied ? "Generated prompt copied" : "Could not copy generated prompt",
  );
}

function state(node) {
  const current = {
    idea: String(value(node, "idea", "")),
    mode: String(value(node, "mode", "Enhance")),
    target_model: String(value(node, "target_model", "Generic")),
    creativity: String(value(node, "creativity", "Balanced")),
    runtime: normalizeRuntime(value(node, "runtime", "LLAMA.CPP")),
    ollama_model: String(value(node, "ollama_model", DEFAULT_OLLAMA_MODEL)).trim() || DEFAULT_OLLAMA_MODEL,
    ollama_endpoint: String(value(node, "ollama_endpoint", DEFAULT_OLLAMA_ENDPOINT)).trim() || DEFAULT_OLLAMA_ENDPOINT,
    prompt_model: normalizePromptModel(value(node, "prompt_model", "Qwen 3.5 9B")),
    director_preset: String(value(node, "director_preset", DEFAULT_DIRECTOR_PRESET)),
    director_profile: String(value(node, "director_profile", "")),
    director_model_path: String(value(node, "director_model_path", "")),
    director_mmproj_path: String(value(node, "director_mmproj_path", "")),
    director_llama_server: String(value(node, "director_llama_server", "")),
    director_context_size: Number(value(node, "director_context_size", 8192)),
    director_image_min_tokens: Number(value(node, "director_image_min_tokens", 1024)),
    director_max_tokens: Number(value(node, "director_max_tokens", 768)),
    director_gpu_layers: String(value(node, "director_gpu_layers", "auto")),
    preserve_subject: Boolean(value(node, "preserve_subject", true)),
    preserve_composition: Boolean(value(node, "preserve_composition", false)),
    preserve_camera: Boolean(value(node, "preserve_camera", false)),
    preserve_materials: Boolean(value(node, "preserve_materials", false)),
    preserve_lighting: Boolean(value(node, "preserve_lighting", false)),
    preserve_colors: Boolean(value(node, "preserve_colors", false)),
    prompt_length: normalizePromptLength(value(node, "prompt_length", "Medium")),
    custom_instructions: String(value(node, "custom_instructions", "")),
    system_prompt_override: String(value(node, "system_prompt_override", "")),
    generated_prompt: String(value(node, "generated_prompt", "")),
    image_1_role: String(value(node, "image_1_role", "Auto")),
    image_2_role: String(value(node, "image_2_role", "Auto")),
    lock_generated_prompt: Boolean(value(node, "lock_generated_prompt", false)),
  };
  REFERENCE_MAP_FIELDS.forEach(([field]) => { current[field] = String(value(node, field, "Auto")); });
  return {...current, ...engineState(node)};
}

function textOnlyPayload(current) {
  return {
    ...Object.fromEntries(ENGINE_FIELDS.map(key => [key, current[key]])),
    idea: current.idea,
    mode: current.mode,
    target_model: current.target_model,
    creativity: current.creativity,
    runtime: current.runtime,
    ollama_model: current.ollama_model,
    ollama_endpoint: current.ollama_endpoint,
    prompt_model: current.prompt_model,
    director_preset: current.director_preset,
    director_profile: current.director_profile,
    director_model_path: current.director_model_path,
    director_mmproj_path: current.director_mmproj_path,
    director_llama_server: current.director_llama_server,
    director_context_size: current.director_context_size,
    director_image_min_tokens: current.director_image_min_tokens,
    director_max_tokens: current.director_max_tokens,
    director_gpu_layers: current.director_gpu_layers,
    prompt_length: current.prompt_length,
    custom_instructions: current.custom_instructions,
    system_prompt_override: current.system_prompt_override,
  };
}

function directorProfiles(node) {
  return Array.isArray(node._kooPrompter11Discovery?.profiles)
    ? node._kooPrompter11Discovery.profiles : [];
}

function directorPresets(node) {
  return Array.isArray(node._kooPrompter11Presets?.presets)
    ? node._kooPrompter11Presets.presets : [];
}

function activeDirectorPreset(node, directorState = state(node)) {
  return directorPresets(node).find((item) => item.label === directorState.director_preset) || null;
}

function promptModelOptions(node) {
  const discovered = directorProfiles(node)
    .filter((profile) => profile.vision_ready && profile.prompt_model && profile.prompt_model !== "Custom")
    .map((profile) => profile.prompt_model);
  if (!discovered.length) return PROMPT_MODELS;
  const current = normalizePromptModel(value(node, "prompt_model", PROMPT_MODELS[0]));
  return [...new Set([...discovered, current, "Custom"])];
}

function ollamaModelOptions(node) {
  const installed = Array.isArray(node._kooPrompter11Discovery?.ollama_models)
    ? node._kooPrompter11Discovery.ollama_models.filter(Boolean) : [];
  const current = String(value(node, "ollama_model", DEFAULT_OLLAMA_MODEL)).trim() || DEFAULT_OLLAMA_MODEL;
  return [...new Set([...installed, current])];
}

function ollamaModelInstalled(models, selected) {
  const identity = String(selected || "").replace(/:latest$/i, "").toLowerCase();
  return (models || []).some((model) => String(model).replace(/:latest$/i, "").toLowerCase() === identity);
}

function directorPresetOptions(node) {
  const discovered = directorPresets(node).map((preset) => preset.label).filter(Boolean);
  return discovered.length ? discovered : DIRECTOR_PRESETS;
}

function directorWarning(node, directorState) {
  const discovery = node._kooPrompter11Discovery;
  if (!discovery) return "";
  const selected = directorState.prompt_model === "Custom"
    ? directorProfiles(node).find((item) => item.id === directorState.director_profile)
    : discovery.assignments?.[directorState.prompt_model];
  if (selected?.warning) return selected.warning;
  const warnings = Array.isArray(discovery.warnings) ? discovery.warnings.filter(Boolean) : [];
  if (!warnings.length) return "";
  return `${warnings[0]}${warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}`;
}

function directorHint(node, directorState) {
  return node._kooPrompter11Connection || "Disconnected — test connection";
}

function presetHint(node, directorState) {
  if (node._kooPrompter11PresetsLoading) return "Loading preset definition...";
  if (node._kooPrompter11PresetsError) return "Director library unavailable";
  const preset = activeDirectorPreset(node, directorState);
  return preset?.description || "Preset controls prompt behavior independently from the model";
}

async function refreshDirectorProfiles(node, force = false) {
  if (node._kooPrompter11ModelsLoading) return;
  const requestId = (node._kooPrompter11ModelsRequestId || 0) + 1;
  node._kooPrompter11ModelsRequestId = requestId;
  node._kooPrompter11ModelsLoading = true;
  try {
    const data = await engineApi("models", {...engineState(node), director_mmproj_path: value(node, "director_mmproj_path", "")});
    if (node._kooPrompter11ModelsRequestId !== requestId) return;
    node._kooPrompter11Discovery = data;
    if (data.runtime) node._apesRuntime = data.runtime;
    node._kooPrompter11Connection = value(node, "provider_preset") === "llama.cpp"
      ? (data.runtime?.available ? `${data.models.length} local models — runtime ready` : data.runtime?.error || "Local runtime missing — install or select below")
      : `Connected — ${data.models.length} models found`;
    node._kooPrompter11ModelsError = "";
    if (data.selection_error) {
      node._kooPrompter11Connection = data.selection_error;
      setStatus(node, "error", data.selection_error);
    }
  } catch (error) {
    if (node._kooPrompter11ModelsRequestId !== requestId) return;
    node._kooPrompter11ModelsError = error.message;
    node._kooPrompter11Connection = `${error.message} — manual ID available`;
  } finally {
    if (node._kooPrompter11ModelsRequestId === requestId) node._kooPrompter11ModelsLoading = false;
    node.setDirtyCanvas(true, true);
  }
}

async function refreshDirectorPresets(node, force = false) {
  if (node._kooPrompter11PresetsLoading) return;
  node._kooPrompter11PresetsLoading = true;
  node._kooPrompter11PresetsError = "";
  node.setDirtyCanvas(true, true);
  try {
    const suffix = force ? "?refresh=1" : "";
    const response = await api.fetchApi(`${PRESETS_ROUTE}${suffix}`);
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || !data.ok || !Array.isArray(data.presets)) throw new Error(data.error || `Preset loading failed (${response.status})`);
    node._kooPrompter11Presets = data;
  } catch (error) {
    node._kooPrompter11PresetsError = error?.message || "Preset loading failed";
  } finally {
    node._kooPrompter11PresetsLoading = false;
    node.setDirtyCanvas(true, true);
  }
}

function configureReferenceInputs(node) {
  const image1 = (node.inputs || []).find((item) => item?.name === "image");
  const image2 = (node.inputs || []).find((item) => item?.name === "image_2");
  if (image1) image1.label = "IMAGE 1";
  if (image2) image2.label = "IMAGE 2";
}

function connectedReferences(node) {
  return [
    ["image", "IMAGE 1", "image_1_role"],
    ["image_2", "IMAGE 2", "image_2_role"],
  ].filter(([name]) => (node.inputs || []).find((item) => item?.name === name)?.link != null);
}

function groundingLabel(node) {
  const references = connectedReferences(node);
  if (references.length === 2) return "2 REFERENCES GROUNDED AT QUEUE";
  return references.length === 1 ? `${references[0][1]} GROUNDED AT QUEUE` : "";
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    lines[maxLines - 1] = ellipsize(ctx, `${lines[maxLines - 1]}...`, maxWidth);
  }
  return lines;
}

function drawParagraph(ctx, text, box, color, placeholder, tokens, maxLines = 4) {
  ctx.font = "500 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
  const content = String(text || "").trim();
  const lines = wrapLines(ctx, content || placeholder, box.w - 24, maxLines);
  lines.forEach((line, index) => drawText(ctx, line, box.x + 12, box.y + 20 + index * 18, 13, content ? color : tokens.textMuted, "500"));
}

function nativeInputContentStart(node) {
  const nativeInputs = (node.inputs || []).filter((item) => !item?.widget);
  if (!nativeInputs.length) return 14;
  const slotHeight = Number(globalThis.LiteGraph?.NODE_SLOT_HEIGHT) || 20;
  const rowGap = 6;
  return 14 + nativeInputs.length * slotHeight + rowGap;
}

function makeLayout(node) {
  const width = Math.max(400, node.size?.[0] || 460);
  const x = 14;
  const w = width - 28;
  let y = nativeInputContentStart(node);
  const gap = 10;
  const hits = [];
  const hit = (kind, box, field = null) => hits.push({ kind, field, ...box });

  const idea = { x, y, w, h: 96 }; hit("text", idea, "idea"); y += idea.h + gap;
  const runtime = {x, y, w, h: value(node, "provider_preset") === "llama.cpp" ? 146 : 108, label: "LLM ENGINE", segments: []};
  const providerBox = {x, y: y + 20, w, h: 30};
  runtime.segments.push(providerBox); hit("enginePreset", providerBox);
  hit("refreshModels", {x, y: y + 58, w: (w - 8) / 2, h: 28});
  hit("testConnection", {x: x + (w + 8) / 2, y: y + 58, w: (w - 8) / 2, h: 28});
  if (value(node, "provider_preset") === "llama.cpp") {
    hit("installRuntime", {x, y: y + 112, w: (w - 8) / 2, h: 28});
    hit("selectServer", {x: x + (w + 8) / 2, y: y + 112, w: (w - 8) / 2, h: 28});
  }
  y += runtime.h + gap;
  const selectGap = 7;
  const selectW = (w - selectGap * 2) / 3;
  const selectors = [
    { field: "mode", label: "MODE", options: MODES, x, y, w: selectW, h: 58 },
    { field: "target_model", label: "TARGET", options: TARGETS, x: x + selectW + selectGap, y, w: selectW, h: 58 },
    { field: "creativity", label: "CREATIVITY", options: CREATIVITY, x: x + (selectW + selectGap) * 2, y, w: selectW, h: 58 },
  ];
  selectors.forEach((box) => hit("choice", box, box.field)); y += 58 + gap;
  const ollamaRuntime = true;
  const localBrowse = value(node, "provider_preset") === "llama.cpp";
  const promptModel = {field: "engine_model", label: "MODEL", options: [], x, y, w: localBrowse ? w - 118 : w, h: 58};
  if (localBrowse) hit("browseGGUF", {x: x + w - 110, y: y + 22, w: 110, h: 36});
  hit("engineModel", promptModel); y += promptModel.h + gap;
  const directorPreset = { field: "director_preset", label: "DIRECTOR PRESET", options: DIRECTOR_PRESETS, x, y, w, h: 58 };
  hit("choice", directorPreset, "director_preset"); y += directorPreset.h + gap;
  const generate = { x, y, w, h: 42 }; hit("generate", generate); y += 42 + gap;
  const output = { x, y, w, h: 126 };
  const copyGenerated = { x: x + w - 128, y: y + 103, w: 58, h: 20 };
  hit("copyGenerated", copyGenerated);
  hit("text", output, "generated_prompt");
  y += 126 + gap;

  const open = node.properties?.kooPrompter11AdvancedOpen === true;
  const customDirector = !ollamaRuntime && normalizePromptModel(value(node, "prompt_model", "Qwen 3.5 9B")) === "Custom";
  const userDirector = activeDirectorPreset(node)?.source === "user";
  const connected = connectedReferences(node);
  const referenceMapRows = REFERENCE_MAP_FIELDS.length;
  const referenceMapHeight = connected.length ? 24 + referenceMapRows * 27 : 0;
  const advancedExtra = 78 + referenceMapHeight;
  const advanced = { x, y, w, h: open ? (customDirector ? 428 : 364) + advancedExtra : 40 };
  hit("advanced", { x, y, w, h: 40 });
  const preserve = [];
  const referenceMap = [];
  let referenceMapHeader = null;
  let lockPrompt = null;
  let length = null;
  let custom = null;
  let system = null;
  let resetPreset = null;
  let saveAsDirector = null;
  let deleteDirector = null;
  let directorStatus = null;
  let unloadModel = null;
  let refreshModels = null;
  let customProfile = null;
  if (open) {
    const colW = (w - 28) / 3;
    PRESERVE_FIELDS.forEach(([field, label], index) => {
      const box = { field, label, x: x + 14 + (index % 3) * colW, y: y + 62 + Math.floor(index / 3) * 30, w: colW, h: 24 };
      preserve.push(box); hit("toggle", box, field);
    });
    let contentY = 130;
    if (connected.length) {
      referenceMapHeader = { x: x + 14, y: y + contentY, w: w - 28, h: 20 };
      const hasImage1 = connected.some(([name]) => name === "image");
      const hasImage2 = connected.some(([name]) => name === "image_2");
      const labelW = Math.min(112, Math.max(92, (w - 28) * 0.27));
      const segmentGap = 3;
      const selectorX = x + 14 + labelW + 7;
      const selectorW = w - 28 - labelW - 7;
      const segmentW = (selectorW - segmentGap * 3) / 4;
      REFERENCE_MAP_FIELDS.forEach(([field, label], index) => {
        const rowY = y + contentY + 22 + index * 27;
        const segments = REFERENCE_SOURCES.map((source, sourceIndex) => {
          const disabled = (source === "Image 1" && !hasImage1)
            || (source === "Image 2" && !hasImage2)
            || (source === "Blend" && !(hasImage1 && hasImage2));
          const segment = {
            field, value: source, disabled,
            x: selectorX + sourceIndex * (segmentW + segmentGap), y: rowY + 1, w: segmentW, h: 22,
          };
          hit("referenceSource", segment, field);
          return segment;
        });
        referenceMap.push({ field, label, x: x + 14, y: rowY, w: w - 28, h: 24, segments });
      });
      contentY += referenceMapHeight;
    }
    lockPrompt = { field: "lock_generated_prompt", label: "LOCK GENERATED PROMPT", x: x + 14, y: y + contentY, w: w - 28, h: 24 };
    hit("toggle", lockPrompt, "lock_generated_prompt");
    contentY += 34;
    length = { x: x + 14, y: y + contentY, w: w - 28, h: 36, field: "prompt_length", label: "PROMPT LENGTH", options: LENGTHS };
    hit("choice", length, "prompt_length");
    custom = { x: x + 14, y: y + contentY + 46, w: w - 28, h: 52 }; hit("text", custom, "custom_instructions");
    const buttonGap = 6;
    const buttonWidths = userDirector ? [54, 58, 58] : [54, 58];
    const actionWidth = buttonWidths.reduce((total, width) => total + width, 0) + buttonGap * (buttonWidths.length - 1);
    let actionX = x + w - 14 - actionWidth;
    system = { x: x + 14, y: y + contentY + 118, w: actionX - (x + 14) - 8, h: 52 }; hit("text", system, "system_prompt_override");
    resetPreset = { x: actionX, y: y + contentY + 126, w: buttonWidths[0], h: 36 }; hit("resetPreset", resetPreset);
    actionX += buttonWidths[0] + buttonGap;
    saveAsDirector = { x: actionX, y: y + contentY + 126, w: buttonWidths[1], h: 36 }; hit("saveAsDirector", saveAsDirector);
    if (userDirector) {
      actionX += buttonWidths[1] + buttonGap;
      deleteDirector = { x: actionX, y: y + contentY + 126, w: buttonWidths[2], h: 36 }; hit("deleteDirector", deleteDirector);
    }
    directorStatus = { x: x + 14, y: y + contentY + 188, w: w - 234, h: 30 };
    unloadModel = { x: x + w - 212, y: y + contentY + 188, w: 112, h: 30 }; hit("unloadModel", unloadModel);
    refreshModels = { x: x + w - 94, y: y + contentY + 188, w: 80, h: 30 }; hit("refreshModels", refreshModels);
    if (customDirector) {
      customProfile = { field: "director_profile", label: "CUSTOM PROFILE", x: x + 14, y: y + contentY + 228, w: w - 28, h: 54 };
      hit("directorProfile", customProfile, "director_profile");
    }
  }
  if (open) hit("engineSettings", {x: x + 14, y: y + advanced.h - 40, w: w - 28, h: 30});
  y += advanced.h + 8;

  const appearanceOpen = node.properties?.kooPrompter11AppearanceOpen === true;
  const appearance = { x, y, w, h: appearanceOpen ? 150 : 40 };
  hit("appearance", { x, y, w, h: 40 });
  const themeButtons = [];
  const swatches = [];
  let contrast = null;
  let customAccent = null;
  let resetAccent = null;
  if (appearanceOpen) {
    const themeW = 58;
    THEMES.forEach((name, index) => {
      const box = { name, x: x + 78 + index * (themeW + 6), y: y + 42, w: themeW, h: 28 };
      themeButtons.push(box); hit("theme", box, name);
    });
    contrast = { x: x + w - 98, y: y + 42, w: 84, h: 28 }; hit("contrast", contrast);
    SWATCHES.forEach((color, index) => {
      const box = { color, x: x + 78 + index * 27, y: y + 84, w: 18, h: 18 };
      swatches.push(box); hit("accent", box, color);
    });
    customAccent = { x: x + 78, y: y + 116, w: 92, h: 20 }; hit("customAccent", customAccent);
    resetAccent = { x: x + 184, y: y + 116, w: 90, h: 20 }; hit("resetAccent", resetAccent);
  }
  y += appearance.h + 8;
  const footer = { x, y, w, h: 22 };
  const desiredHeight = footer.y + footer.h + 10;
  return { width, desiredHeight, hits, idea, runtime, selectors, promptModel, directorPreset, generate, output, copyGenerated, advanced, preserve, referenceMap, referenceMapHeader, lockPrompt, length, custom, system, resetPreset, saveAsDirector, deleteDirector, directorStatus, unloadModel, refreshModels, customProfile, appearance, themeButtons, swatches, contrast, customAccent, resetAccent, footer };
}

function drawSelector(ctx, box, selected, tokens, accent) {
  drawText(ctx, box.label, box.x + 2, box.y + 11, 11, tokens.textMuted, "850");
  const field = { x: box.x, y: box.y + 22, w: box.w, h: 34 };
  drawRound(ctx, field, tokens.surface, tokens.border, 1, 6);
  drawText(ctx, ellipsize(ctx, selected, field.w - 30), field.x + 10, field.y + 17, 12, tokens.text, "700");
  drawText(ctx, "v", field.x + field.w - 14, field.y + 17, 12, accent, "900", "center");
}

function drawUI(node, ctx) {
  ensureProperties(node);
  const s = state(node);
  const t = THEME_TOKENS[node.properties.kooPrompter11Theme] || THEME_TOKENS.Dark;
  const accent = node.properties.kooPrompter11Accent;
  const palette = buildAccentPalette(accent, node.properties.kooPrompter11Contrast);
  const l = makeLayout(node);
  node._kooPrompter11Hits = l.hits;
  if (!node.size || Math.abs(node.size[1] - l.desiredHeight) > 2) node.size = [l.width, l.desiredHeight];

  drawRound(ctx, { x: 7, y: 7, w: l.width - 14, h: l.desiredHeight - 14 }, t.background, t.borderStrong, 1.5, 12);
  drawText(ctx, "WHAT DO YOU WANT?", l.idea.x + 2, l.idea.y + 11, 11, accent, "850");
  const grounding = groundingLabel(node);
  if (grounding) drawText(ctx, grounding, l.idea.x + l.idea.w - 2, l.idea.y + 11, 10, accent, "800", "right");
  const ideaBox = { x: l.idea.x, y: l.idea.y + 22, w: l.idea.w, h: 74 };
  drawRound(ctx, ideaBox, t.surface, t.border, 1, 7);
  drawParagraph(ctx, s.idea, ideaBox, t.text, "Describe the image or the change you want...", t, 3);
  drawText(ctx, "EDIT", ideaBox.x + ideaBox.w - 26, ideaBox.y + ideaBox.h - 11, 10, accent, "850", "center");

  drawText(ctx, l.runtime.label, l.runtime.x + 2, l.runtime.y + 10, 11, t.textMuted, "850");
  l.runtime.segments.forEach((box) => {
    drawRound(ctx, box, t.surface, t.border, 1, 6);
    drawText(ctx, s.provider_preset + "  ▾", box.x + 12, box.y + 16, 12, t.text, "700");
  });
  for (const kind of ["refreshModels", "testConnection"]) {
    const box = l.hits.find(hit => hit.kind === kind);
    drawRound(ctx, box, t.surface, t.border, 1, 6);
    drawText(ctx, kind === "refreshModels" ? "REFRESH MODELS" : s.provider_preset === "llama.cpp" ? "CHECK LOCAL MODEL" : "TEST CONNECTION", box.x + box.w / 2, box.y + 15, 10, t.text, "700", "center");
  }
  drawText(ctx, ellipsize(ctx, directorHint(node, s), l.runtime.w), l.runtime.x, l.runtime.y + 101, 10, t.textMuted, "600");
  for (const kind of ["installRuntime", "selectServer"]) {
    const box = l.hits.find(hit => hit.kind === kind);
    if (!box) continue;
    drawRound(ctx, box, t.surfaceRaised, accent, 1, 6);
    drawText(ctx, kind === "installRuntime" ? (node._apesRuntime?.available ? "RUNTIME READY" : "INSTALL LOCAL RUNTIME") : "SELECT LLAMA-SERVER", box.x + box.w / 2, box.y + 15, 10, t.text, "700", "center");
  }
  const engineSettings = l.hits.find(hit => hit.kind === "engineSettings");
  l.selectors.forEach((box) => drawSelector(ctx, box, s[box.field], t, accent));
  drawSelector(ctx, l.promptModel, s.provider_preset === "llama.cpp" ? localModelLabel(s.engine_model) : s[l.promptModel.field], t, accent);
  const browse = l.hits.find(hit => hit.kind === "browseGGUF");
  if (browse) {
    drawRound(ctx, browse, t.surface, t.border, 1, 6);
    drawText(ctx, "📁 Browse GGUF", browse.x + browse.w / 2, browse.y + 19, 11, t.text, "700", "center");
  }

  drawSelector(ctx, l.directorPreset, s.director_preset, t, accent);
  drawText(ctx, ellipsize(ctx, presetHint(node, s), l.directorPreset.w - 140), l.directorPreset.x + l.directorPreset.w - 2, l.directorPreset.y + 11, 10, t.textMuted, "650", "right");
  const busy = node._kooPrompter11Status?.kind === "generating";
  drawRound(ctx, l.generate, busy ? t.surfaceRaised : activeFill(palette, 0.9), accent, 1.5, 7);
  drawText(ctx, busy ? "GENERATING..." : "GENERATE", l.generate.x + l.generate.w / 2, l.generate.y + 21, 14, busy ? t.textMuted : activeForeground(palette, t.text), "900", "center");

  drawText(ctx, "GENERATED PROMPT", l.output.x + 2, l.output.y + 11, 11, t.textMuted, "850");
  const outputBox = { x: l.output.x, y: l.output.y + 22, w: l.output.w, h: 104 };
  drawRound(ctx, outputBox, t.surface, s.generated_prompt ? accent : t.border, s.generated_prompt ? 1.5 : 1, 7);
  drawParagraph(ctx, s.generated_prompt, outputBox, t.text, "The generated prompt will appear here...", t, 4);
  const copyFeedback = node._kooPrompter11CopyFeedback;
  const copyLabel = copyFeedback?.until > Date.now() ? copyFeedback.label : "COPY";
  const copyActive = copyLabel === "COPIED!";
  drawRound(ctx, l.copyGenerated, t.surfaceRaised, copyActive ? "#2ED6A3" : s.generated_prompt ? accent : t.border, 1, 5);
  drawText(ctx, copyLabel, l.copyGenerated.x + l.copyGenerated.w / 2, l.copyGenerated.y + l.copyGenerated.h / 2 + 1, 9, copyActive ? "#2ED6A3" : s.generated_prompt ? accent : t.textMuted, "850", "center");
  if (s.generated_prompt) drawText(ctx, "EDIT", outputBox.x + outputBox.w - 26, outputBox.y + outputBox.h - 11, 10, accent, "850", "center");

  drawRound(ctx, l.advanced, t.surface, t.border, 1, 7);
  drawText(ctx, "ADVANCED", l.advanced.x + 14, l.advanced.y + 20, 12, t.textMuted, "850");
  drawText(ctx, node.properties.kooPrompter11AdvancedOpen ? "^" : "v", l.advanced.x + l.advanced.w - 20, l.advanced.y + 20, 14, t.textSecondary, "900", "center");
  if (node.properties.kooPrompter11AdvancedOpen) {
    if (engineSettings) {
      drawRound(ctx, engineSettings, t.surfaceRaised, t.border, 1, 6);
      drawText(ctx, "ENGINE SETTINGS / API KEY", engineSettings.x + engineSettings.w / 2, engineSettings.y + 16, 11, t.text, "700", "center");
    }
    drawText(ctx, "PRESERVE", l.advanced.x + 14, l.advanced.y + 50, 11, t.textMuted, "850");
    l.preserve.forEach((box) => {
      const on = Boolean(s[box.field]);
      const check = { x: box.x, y: box.y + 3, w: 17, h: 17 };
      drawRound(ctx, check, on ? hexToRgba(accent, 0.25) : t.background, on ? accent : t.border, on ? 2 : 1, 4);
      if (on) drawText(ctx, "✓", check.x + 8.5, check.y + 8.5, 12, accent, "900", "center");
      drawText(ctx, box.label, box.x + 24, box.y + 12, 11, on ? t.text : t.textSecondary, on ? "750" : "600");
    });
    if (l.referenceMapHeader) {
      const manualCount = REFERENCE_MAP_FIELDS.filter(([field]) => s[field] !== "Auto").length;
      const legacyRoles = s.image_1_role !== "Auto" || s.image_2_role !== "Auto";
      const mapStatus = manualCount ? `${manualCount} MANUAL · REST AUTO`
        : legacyRoles ? "LEGACY SHORTCUTS → RESOLVED" : "AUTO RESOLVED BEFORE GENERATION";
      drawText(ctx, "REFERENCE MAP", l.referenceMapHeader.x, l.referenceMapHeader.y + 11, 11, t.textMuted, "850");
      drawText(ctx, mapStatus, l.referenceMapHeader.x + l.referenceMapHeader.w, l.referenceMapHeader.y + 11, 9.5, t.textMuted, "650", "right");
      l.referenceMap.forEach((box) => {
        const source = s[box.field] || "Auto";
        const manual = source !== "Auto";
        drawText(ctx, ellipsize(ctx, box.label, box.segments[0].x - box.x - 9), box.x, box.y + 12, 10, manual ? t.text : t.textSecondary, manual ? "750" : "600");
        box.segments.forEach((segment) => {
          const selected = segment.value === source;
          const fill = selected ? activeFill(palette, 0.88) : segment.disabled ? t.surface : t.background;
          const border = selected ? accent : t.border;
          const foreground = selected ? activeForeground(palette, t.text) : segment.disabled ? t.textMuted : t.textSecondary;
          drawRound(ctx, segment, fill, border, selected ? 1.5 : 1, 5);
          drawText(
            ctx,
            REFERENCE_SOURCE_LABELS[segment.value],
            segment.x + segment.w / 2,
            segment.y + 12,
            9,
            foreground,
            selected ? "850" : segment.disabled ? "550" : "700",
            "center",
          );
          if (segment.disabled) {
            ctx.save();
            ctx.globalAlpha = 0.42;
            ctx.beginPath();
            ctx.moveTo(segment.x + 5, segment.y + segment.h - 5);
            ctx.lineTo(segment.x + segment.w - 5, segment.y + 5);
            ctx.strokeStyle = t.textMuted;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
          }
        });
      });
    }
    const locked = s.lock_generated_prompt;
    const lockCheck = { x: l.lockPrompt.x, y: l.lockPrompt.y + 3, w: 17, h: 17 };
    drawRound(ctx, lockCheck, locked ? hexToRgba(accent, 0.25) : t.background, locked ? accent : t.border, locked ? 2 : 1, 4);
    if (locked) drawText(ctx, "✓", lockCheck.x + 8.5, lockCheck.y + 8.5, 12, accent, "900", "center");
    drawText(ctx, l.lockPrompt.label, l.lockPrompt.x + 24, l.lockPrompt.y + 12, 11, locked ? t.text : t.textSecondary, locked ? "750" : "600");
    drawText(ctx, locked ? "ON — EXACT OUTPUT · NO INFERENCE" : "OFF — GENERATE AT QUEUE", l.lockPrompt.x + l.lockPrompt.w, l.lockPrompt.y + 12, 10, t.textMuted, "600", "right");
    drawText(ctx, l.length.label, l.length.x, l.length.y - 7, 11, t.textMuted, "850");
    drawSelector(ctx, { ...l.length, x: l.length.x + 106, y: l.length.y - 22, w: l.length.w - 106, label: "" }, s.prompt_length, t, accent);
    drawText(ctx, "WORKFLOW RULES — OPTIONAL", l.custom.x, l.custom.y - 7, 11, t.textMuted, "850");
    drawRound(ctx, l.custom, t.background, t.border, 1, 6);
    drawText(ctx, WORKFLOW_RULES_HELP, l.custom.x + 10, l.custom.y + 15, 10, t.textMuted, "600");
    const extraStatus = s.custom_instructions.trim() ? "Workflow rules configured — click to edit" : WORKFLOW_RULES_PLACEHOLDER;
    drawText(ctx, ellipsize(ctx, extraStatus, l.custom.w - 20), l.custom.x + 10, l.custom.y + 36, 10.5, s.custom_instructions.trim() ? t.text : t.textMuted, "600");
    drawText(ctx, `DIRECTOR BEHAVIOR — ${s.director_preset}`, l.system.x, l.system.y - 7, 10, t.textMuted, "850");
    drawRound(ctx, l.system, t.background, s.system_prompt_override.trim() ? accent : t.border, s.system_prompt_override.trim() ? 1.5 : 1, 6);
    drawText(ctx, ellipsize(ctx, DIRECTOR_BEHAVIOR_HELP, l.system.w - 18), l.system.x + 10, l.system.y + 15, 10, t.textMuted, "600");
    const systemStatus = node._kooPrompter11PresetsError
      ? "Director unavailable — edit working copy"
      : s.system_prompt_override.trim() ? "Working copy edited — click to inspect" : "Saved behavior — click to inspect";
    drawText(ctx, ellipsize(ctx, systemStatus, l.system.w - 18), l.system.x + 10, l.system.y + 36, 10.5, s.system_prompt_override.trim() ? t.text : t.textMuted, "600");
    drawRound(ctx, l.resetPreset, t.surfaceRaised, t.border, 1, 5);
    drawText(ctx, "RESET", l.resetPreset.x + l.resetPreset.w / 2, l.resetPreset.y + 18, 9, t.textSecondary, "800", "center");
    drawRound(ctx, l.saveAsDirector, t.surfaceRaised, t.border, 1, 5);
    drawText(ctx, node._kooPrompter11Saving ? "WAIT" : "SAVE AS", l.saveAsDirector.x + l.saveAsDirector.w / 2, l.saveAsDirector.y + 18, 8.5, t.textSecondary, "800", "center");
    if (l.deleteDirector) {
      drawRound(ctx, l.deleteDirector, t.surfaceRaised, t.border, 1, 5);
      drawText(ctx, node._kooPrompter11Deleting ? "WAIT" : "DELETE", l.deleteDirector.x + l.deleteDirector.w / 2, l.deleteDirector.y + 18, 8.5, node._kooPrompter11Deleting ? t.textMuted : "#FF5B68", "800", "center");
    }
    const discoveryMessage = node._kooPrompter11Connection || "Disconnected";
    drawText(ctx, ellipsize(ctx, discoveryMessage, l.directorStatus.w), l.directorStatus.x, l.directorStatus.y + 16, 10, t.textMuted, "600");
    if (enginePresets[s.provider_preset]?.capabilities.supports_unload) {
    drawRound(ctx, l.unloadModel, t.surfaceRaised, accent, 1, 5);
      drawText(ctx, node._kooPrompter11Unloading ? "Unloading..." : "Unload Model", l.unloadModel.x + l.unloadModel.w / 2, l.unloadModel.y + l.unloadModel.h / 2 + 1, 10, node._kooPrompter11Unloading ? t.textMuted : accent, "800", "center");
    }
    drawRound(ctx, l.refreshModels, t.surfaceRaised, t.border, 1, 5);
    drawText(ctx, node._kooPrompter11ModelsLoading ? (s.runtime === "OLLAMA" ? "WAIT" : "SCANNING") : "REFRESH", l.refreshModels.x + l.refreshModels.w / 2, l.refreshModels.y + l.refreshModels.h / 2 + 1, 10, t.textSecondary, "800", "center");
    if (l.customProfile) {
      const selectedProfile = directorProfiles(node).find((item) => item.id === s.director_profile);
      const profileLabel = selectedProfile
        ? `${selectedProfile.label}${selectedProfile.vision_ready ? "" : " — Incomplete"}`
        : "Select discovered profile (optional)";
      drawSelector(ctx, l.customProfile, profileLabel, t, accent);
    }
  }

  drawRound(ctx, l.appearance, t.surface, t.border, 1, 7);
  drawPaletteIcon(ctx, l.appearance.x + 14, l.appearance.y + 11, accent, t);
  drawText(ctx, "APPEARANCE", l.appearance.x + 42, l.appearance.y + 20, 12, t.textMuted, "850");
  drawText(ctx, node.properties.kooPrompter11AppearanceOpen ? "^" : "v", l.appearance.x + l.appearance.w - 20, l.appearance.y + 20, 14, t.textSecondary, "900", "center");
  if (node.properties.kooPrompter11AppearanceOpen) {
    drawText(ctx, "THEME", l.appearance.x + 14, l.appearance.y + 56, 11, t.textMuted, "850");
    l.themeButtons.forEach((box) => {
      const on = node.properties.kooPrompter11Theme === box.name;
      drawRound(ctx, box, on ? activeFill(palette, 0.18) : t.surfaceRaised, on ? accent : t.border, on ? 2 : 1, 5);
      drawText(ctx, box.name, box.x + box.w / 2, box.y + box.h / 2, 11, on ? activeForeground(palette, t.text) : t.textSecondary, on ? "800" : "650", "center");
    });
    const contrastOn = node.properties.kooPrompter11Contrast;
    drawRound(ctx, l.contrast, contrastOn ? activeFill(palette, 0.18) : t.surfaceRaised, contrastOn ? palette.accentBorder : t.border, contrastOn ? 2 : 1, 5);
    const knobSize = 10;
    const knobX = l.contrast.x + l.contrast.w - 16;
    const knobY = l.contrast.y + l.contrast.h / 2;
    drawText(ctx, "Contrast", l.contrast.x + 8, l.contrast.y + l.contrast.h / 2 + 1, 10, contrastOn ? activeForeground(palette, t.text) : t.textSecondary, "750");
    ctx.beginPath(); ctx.arc(knobX, knobY, knobSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = contrastOn ? activeForeground(palette, t.text) : t.textMuted; ctx.fill();
    drawText(ctx, "ACCENT", l.appearance.x + 14, l.appearance.y + 94, 11, t.textMuted, "850");
    l.swatches.forEach((swatch) => {
      ctx.beginPath(); ctx.arc(swatch.x + 9, swatch.y + 9, 8, 0, Math.PI * 2); ctx.fillStyle = swatch.color; ctx.fill();
      if (normalizeHex(swatch.color) === normalizeHex(accent)) { ctx.lineWidth = 2.5; ctx.strokeStyle = t.text; ctx.stroke(); }
    });
    drawText(ctx, `Hex ${accent}`, l.customAccent.x, l.customAccent.y + 10, 11, t.textSecondary, "700");
    drawText(ctx, "Reset Accent", l.resetAccent.x, l.resetAccent.y + 10, 11, t.textSecondary, "700");
  }

  drawInteractionFeedback(node, ctx, l.hits, accent, t);
  const status = node._kooPrompter11Status || { kind: "idle", message: "Ready" };
  const statusColor = status.kind === "success" ? "#2ED6A3" : status.kind === "error" ? "#FF5B68" : status.kind === "generating" ? accent : t.textMuted;
  ctx.beginPath(); ctx.arc(l.footer.x + 5, l.footer.y + 10, 3.5, 0, Math.PI * 2); ctx.fillStyle = statusColor; ctx.fill();
  drawText(ctx, ellipsize(ctx, status.message, l.footer.w - 18), l.footer.x + 14, l.footer.y + 10, 11, statusColor, "600");
}

function editorDialog(node, field) {
  const t = THEME_TOKENS[node.properties?.kooPrompter11Theme] || THEME_TOKENS.Dark;
  const accent = normalizeHex(node.properties?.kooPrompter11Accent) || DEFAULT_ACCENT;
  const palette = buildAccentPalette(accent, Boolean(node.properties?.kooPrompter11Contrast));
  const titles = { idea: "What Do You Want?", generated_prompt: "Generated Prompt", custom_instructions: "Workflow Rules — Optional", system_prompt_override: "Director Behavior" };
  const overlay = document.createElement("div"); overlay.classList.add("apes-dialog");
  overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:24px;";
  const panel = document.createElement("div");
  panel.style.cssText = `box-sizing:border-box;width:min(760px,94vw);background:${t.background};color:${t.text};border:1px solid ${t.borderStrong};border-radius:12px;padding:18px;box-shadow:0 20px 70px rgba(0,0,0,.5);font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;`;
  const title = document.createElement("div");
  title.textContent = titles[field] || field;
  title.style.cssText = `font-size:15px;font-weight:850;margin-bottom:10px;color:${t.text};`;
  const area = document.createElement("textarea");
  const selectedPreset = activeDirectorPreset(node);
  const storedValue = String(value(node, field, ""));
  area.value = field === "system_prompt_override" && !storedValue.trim()
    ? String(selectedPreset?.base_system_prompt || "") : storedValue;
  area.placeholder = field === "idea"
    ? "Describe the image or the change you want..."
    : field === "custom_instructions"
      ? WORKFLOW_RULES_PLACEHOLDER
      : field === "system_prompt_override" ? DIRECTOR_BEHAVIOR_PLACEHOLDER : "";
  area.style.cssText = `box-sizing:border-box;width:100%;height:min(46vh,420px);resize:vertical;background:${t.surface};color:${t.text};border:1px solid ${t.border};border-radius:7px;padding:12px;outline:none;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;`;
  const note = document.createElement("div");
  note.textContent = field === "system_prompt_override"
    ? `Reusable behavior that defines how the selected Director analyzes and writes prompts. Editing the workflow copy of ${selectedPreset?.label || value(node, "director_preset", DEFAULT_DIRECTOR_PRESET)}; use Save As to make it reusable.`
    : field === "custom_instructions"
      ? "Optional rules applied only to this workflow."
      : "Ctrl/Cmd + Enter saves.";
  note.style.cssText = `margin-top:8px;color:${t.textMuted};font-size:11px;`;
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:14px;";
  const cancel = document.createElement("button"); cancel.textContent = "Cancel";
  const save = document.createElement("button"); save.textContent = field === "system_prompt_override" ? "Apply Working Copy" : "Save";
  for (const button of [cancel, save]) button.style.cssText = `border:1px solid ${t.border};border-radius:6px;padding:8px 16px;background:${t.surfaceRaised};color:${t.text};font-weight:750;cursor:pointer;`;
  save.style.background = accent; save.style.borderColor = accent; save.style.color = palette.accentForeground;
  const close = () => overlay.remove();
  const commit = () => {
    const defaultText = String(selectedPreset?.base_system_prompt || "").trim();
    const nextValue = field === "system_prompt_override" && area.value.trim() === defaultText ? "" : area.value;
    setValue(node, field, nextValue, field !== "generated_prompt");
    if (field === "generated_prompt") setStatus(node, "success", "Prompt edited manually");
    close();
  };
  cancel.onclick = close; save.onclick = commit; overlay.onclick = (event) => { if (event.target === overlay) close(); };
  area.onkeydown = (event) => { if (event.key === "Escape") close(); if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit(); };
  actions.append(cancel, save); panel.append(title, area, note, actions); overlay.append(panel); document.body.append(overlay); area.focus();
}

function choiceMenu(node, field, options, event, afterSelect = null) {
  const choose = (choice) => {
    const selected = typeof choice === "string" ? choice : choice?.content;
    if (!selected) return;
    setValue(node, field, selected);
    afterSelect?.(selected);
  };
  const Menu = globalThis.LiteGraph?.ContextMenu;
  if (Menu) {
    new Menu(options, { event, callback: choose });
    return;
  }
  const current = String(value(node, field, options[0]));
  choose(options[(options.indexOf(current) + 1) % options.length]);
}

function customProfileMenu(node, event) {
  const profiles = directorProfiles(node);
  if (!profiles.length) {
    node._kooPrompter11ModelsError = "No local GGUF model folders discovered — try Refresh Models";
    node.setDirtyCanvas(true, true);
    return;
  }
  const labels = profiles.map((profile) => `${profile.label}${profile.vision_ready ? "" : " — Incomplete"}`);
  const choose = (label) => {
    const index = labels.indexOf(label);
    if (index < 0) return;
    setValue(node, "director_profile", profiles[index].id);
    setValue(node, "director_model_path", "", false);
    setValue(node, "director_mmproj_path", "", false);
  };
  const Menu = globalThis.LiteGraph?.ContextMenu;
  if (Menu) {
    new Menu(labels, { event, callback: (choice) => choose(typeof choice === "string" ? choice : choice?.content) });
    return;
  }
  const current = profiles.findIndex((profile) => profile.id === String(value(node, "director_profile", "")));
  choose(labels[(current + 1) % labels.length]);
}

async function saveAsDirector(node) {
  if (node._kooPrompter11Saving) return;
  const selectedPreset = activeDirectorPreset(node);
  const workingCopy = String(value(node, "system_prompt_override", "")).trim();
  const instructions = workingCopy || String(selectedPreset?.instructions || selectedPreset?.base_system_prompt || "").trim();
  if (!instructions) {
    setStatus(node, "error", "Director Behavior cannot be empty");
    return;
  }
  const proposedName = prompt("Save Director As", "");
  if (proposedName === null) return;
  const name = proposedName.trim();
  if (!name) {
    setStatus(node, "error", "Director name cannot be empty");
    return;
  }
  node._kooPrompter11Saving = true;
  node.setDirtyCanvas(true, true);
  try {
    const response = await api.fetchApi(PRESETS_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, instructions, recommended_mode: state(node).mode }),
    });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || !data.ok || !data.director?.label) {
      throw new Error(data.error || `Director save failed (${response.status})`);
    }
    await refreshDirectorPresets(node, true);
    setValue(node, "director_preset", data.director.label);
    setValue(node, "system_prompt_override", "", false);
    setStatus(node, "success", `Saved user Director: ${data.director.label}`);
  } catch (error) {
    setStatus(node, "error", error?.message || "Director save failed");
  } finally {
    node._kooPrompter11Saving = false;
    node.setDirtyCanvas(true, true);
  }
}

async function deleteSelectedDirector(node) {
  if (node._kooPrompter11Deleting) return;
  const selectedPreset = activeDirectorPreset(node);
  if (selectedPreset?.source !== "user" || selectedPreset?.protected !== false) {
    setStatus(node, "error", "Built-in KoO Directors cannot be deleted");
    return;
  }
  if (!globalThis.confirm(`Delete user Director "${selectedPreset.label}"? This cannot be undone.`)) return;
  node._kooPrompter11Deleting = true;
  node.setDirtyCanvas(true, true);
  try {
    const response = await api.fetchApi(PRESETS_ROUTE, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selectedPreset.label }),
    });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Director deletion failed (${response.status})`);
    }
    await refreshDirectorPresets(node, true);
    const recommended = legacyPresetForMode(value(node, "mode", "Enhance"));
    const fallback = directorPresetOptions(node).includes(recommended) ? recommended : DEFAULT_DIRECTOR_PRESET;
    setValue(node, "director_preset", fallback);
    setValue(node, "system_prompt_override", "", false);
    setStatus(node, "success", `Deleted ${selectedPreset.label} · selected ${fallback}`);
  } catch (error) {
    setStatus(node, "error", error?.message || "Director deletion failed");
  } finally {
    node._kooPrompter11Deleting = false;
    node.setDirtyCanvas(true, true);
  }
}

async function unloadModel(node) {
  try { const result = await engineApi("unload", engineState(node)); setStatus(node, "success", result.message); }
  catch (error) { setStatus(node, "error", error.message); }
}

async function generate(node) {
  if (node._kooPrompter11Status?.kind === "generating") return;
  const payload = state(node);
  const imageLinked = connectedReferences(node).length > 0;
  if (payload.lock_generated_prompt) {
    if (!payload.generated_prompt.trim()) {
      setStatus(node, "error", "Generated Prompt is locked but empty. Generate or enter a prompt before queueing.");
    } else {
      setStatus(node, "success", "Generated Prompt locked — queue will return it exactly");
    }
    return;
  }
  if (!payload.idea.trim()) {
    setStatus(node, "error", "Enter a text prompt first.");
    return;
  }
  setStatus(node, "generating", imageLinked ? "Generating text-only preview..." : "Generating prompt...");
  try {
    const response = await api.fetchApi(TEXT_ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(textOnlyPayload(payload)) });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok || !data.ok || !String(data.prompt || "").trim()) throw new Error(data.error || `Prompt Director request failed (${response.status})`);
    setValue(node, "generated_prompt", String(data.prompt).trim(), false);
    const selectedBackend = data.prompt_model || data.director_profile || data.backend || "configured backend";
    const generatedWith = selectedBackend;
    node._kooPrompter11Connection = "Connected — generation complete";
    const activePreset = data.director_preset || payload.director_preset;
    const successMessage = imageLinked ? "Text-only preview — queue graph to ground connected IMAGE" : `Generated with ${generatedWith} · ${activePreset}`;
    setStatus(node, data.warning ? "error" : "success", data.warning || successMessage);
  } catch (error) {
    setStatus(node, "error", error?.message || "Prompt Director generation failed");
  }
}

function handleClick(node, event, pos) {
  const hit = (node._kooPrompter11Hits || makeLayout(node).hits).find((box) => pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h);
  if (!hit) return false;
  if (hit.disabled || node._apesBusy?.[hit.kind]) return true;
  node._apesPressed = hit;
  setTimeout(() => { node._apesPressed = null; node.setDirtyCanvas(true, true); }, 180);
  if (hit.kind === "installRuntime") { runAction(node, hit.kind, "Installing...", () => installRuntime(node));
  } else if (hit.kind === "selectServer") { runtimeDialog(node);
  } else if (hit.kind === "enginePreset") {
    choiceMenu(node, "provider_preset", Object.keys(enginePresets), event, selected => {
      const preset = enginePresets[selected];
      if (preset) setValue(node, "base_url", preset.base_url);
      setValue(node, "engine_model", ""); invalidateEngine(node);
      if (selected === "llama.cpp") runAction(node, "refreshModels", "Refreshing...", () => refreshDirectorProfiles(node, true));
    });
  } else if (hit.kind === "browseGGUF") { browseGGUF(node);
  } else if (hit.kind === "engineModel" && value(node, "provider_preset") === "llama.cpp") {
    const models = [...new Set([...(node._kooPrompter11Discovery?.models || []), ...Object.keys(manualModels(node)), value(node, "engine_model", "")].filter(Boolean))];
    if (!models.length) { runAction(node, "refreshModels", "Refreshing...", () => refreshDirectorProfiles(node, true)); return true; }
    choiceMenu(node, "engine_model", models, event, selected => {
      const saved = manualModels(node)[selected];
      setValue(node, "director_mmproj_path", saved?.mmproj || "");
      setValue(node, "model_supports_images", saved ? saved.images : true);
      node._kooPrompter11Connection = "Local model selected — starts automatically on Generate";
    });
  } else if (hit.kind === "engineModel") {
    const manual = "Enter manual model ID…";
    const current = String(value(node, "engine_model", ""));
    choiceMenu(node, "engine_model", [...new Set([...(node._kooPrompter11Discovery?.models || []), current].filter(Boolean)), manual], event, selected => {
      if (selected === manual) setValue(node, "engine_model", prompt("Model ID", current)?.trim() || current);
      node._kooPrompter11Connection = "Model changed — test connection";
    });
  } else if (hit.kind === "engineSettings") { engineDialog(node);
  } else if (hit.kind === "testConnection") { runAction(node, "testConnection", "Testing...", () => testConnection(node));
  } else if (hit.kind === "advanced") {
    node.properties.kooPrompter11AdvancedOpen = !node.properties.kooPrompter11AdvancedOpen;
  } else if (hit.kind === "appearance") {
    node.properties.kooPrompter11AppearanceOpen = !node.properties.kooPrompter11AppearanceOpen;
  } else if (hit.kind === "theme") {
    node.properties.kooPrompter11Theme = hit.field;
  } else if (hit.kind === "contrast") {
    node.properties.kooPrompter11Contrast = !node.properties.kooPrompter11Contrast;
  } else if (hit.kind === "accent") {
    node.properties.kooPrompter11Accent = normalizeHex(hit.field) || DEFAULT_ACCENT;
  } else if (hit.kind === "customAccent") {
    const selected = normalizeHex(prompt("Accent hex color", node.properties.kooPrompter11Accent || DEFAULT_ACCENT));
    if (selected) node.properties.kooPrompter11Accent = selected;
  } else if (hit.kind === "resetAccent") {
    node.properties.kooPrompter11Accent = DEFAULT_ACCENT;
  } else if (hit.kind === "copyGenerated") {
    runAction(node, "copyGenerated", "Copying...", () => copyGeneratedPrompt(node));
  } else if (hit.kind === "text") {
    editorDialog(node, hit.field);
  } else if (hit.kind === "resetPreset") {
    setValue(node, "system_prompt_override", "");
    setStatus(node, "idle", `Reset to saved ${value(node, "director_preset", DEFAULT_DIRECTOR_PRESET)} behavior`);
  } else if (hit.kind === "saveAsDirector") {
    runAction(node, "saveAsDirector", "Saving...", () => saveAsDirector(node));
  } else if (hit.kind === "deleteDirector") {
    runAction(node, "deleteDirector", "Deleting...", () => deleteSelectedDirector(node));
  } else if (hit.kind === "runtime") {
    setValue(node, "runtime", hit.field);
    node._kooPrompter11Discovery = null;
    node._kooPrompter11ModelsError = "";
    runAction(node, "refreshModels", "Refreshing...", () => refreshDirectorProfiles(node, true));
  } else if (hit.kind === "toggle") {
    setValue(node, hit.field, !Boolean(value(node, hit.field, false)));
  } else if (hit.kind === "referenceSource") {
    if (hit.disabled) return true;
    setValue(node, hit.field, hit.value);
    setValue(node, "image_1_role", "Auto", false);
    setValue(node, "image_2_role", "Auto", false);
  } else if (hit.kind === "choice") {
    const options = hit.field === "mode" ? MODES
      : hit.field === "target_model" ? TARGETS
          : hit.field === "creativity" ? CREATIVITY
            : hit.field === "prompt_model" ? promptModelOptions(node)
              : hit.field === "ollama_model" ? ollamaModelOptions(node)
            : hit.field === "director_preset" ? directorPresetOptions(node)
              : LENGTHS;
    choiceMenu(node, hit.field, options, event, (selected) => {
      if (hit.field === "mode") {
        setValue(node, "director_preset", legacyPresetForMode(selected), false);
        setValue(node, "system_prompt_override", "", false);
      } else if (hit.field === "director_preset") {
        setValue(node, "system_prompt_override", "", false);
      }
    });
    if (["prompt_model", "ollama_model"].includes(hit.field) && !node._kooPrompter11Discovery) refreshDirectorProfiles(node, false);
  } else if (hit.kind === "directorProfile") {
    customProfileMenu(node, event);
  } else if (hit.kind === "refreshModels") {
    runAction(node, "refreshModels", "Refreshing...", () => refreshDirectorProfiles(node, true));
  } else if (hit.kind === "unloadModel") {
    if (enginePresets[value(node, "provider_preset")]?.capabilities.supports_unload) runAction(node, "unloadModel", "Unloading...", () => unloadModel(node));
  } else if (hit.kind === "generate") {
    runAction(node, "generate", "Generating...", () => generate(node));
  } else return false;
  node.setDirtyCanvas(true, true);
  return true;
}

app.registerExtension({
  name: "KoO.ApesPrompter11",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      ensureProperties(this); detachWidgets(this); configureReferenceInputs(this); this.size = this.size || [460, 450]; this.resizable = true; this.serialize_widgets = true;
      this.title = "KoO Apes Prompter 1.1";
      loadEnginePresets().then(() => this.setDirtyCanvas(true, true)).catch(() => setStatus(this, "error", "Provider presets unavailable; restart ComfyUI"));
      refreshDirectorPresets(this, false);
      return result;
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = configured?.apply(this, arguments);
      ensureProperties(this); detachWidgets(this, info?.widgets_values); configureReferenceInputs(this); this._kooPrompter11Status = { kind: "idle", message: value(this, "generated_prompt", "") ? "Loaded generated prompt" : "Ready" };
      refreshDirectorProfiles(this, false);
      refreshDirectorPresets(this, false);
      return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = executed?.apply(this, arguments);
      const queuePrompt = promptFromExecution(message);
      if (queuePrompt !== null && !Boolean(value(this, "lock_generated_prompt", false))) {
        setValue(this, "generated_prompt", queuePrompt, false);
        setStatus(this, "success", "Generated Prompt updated from workflow result");
      } else if (queuePrompt !== null) {
        setStatus(this, "success", "Locked Generated Prompt returned unchanged");
      }
      return result;
    };
    const serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const data = serialize?.apply(this, arguments) || {};
      data.widgets_values = WIDGET_NAMES.map((name) => value(this, name));
      data.properties = { ...(data.properties || {}), ...(this.properties || {}) };
      return data;
    };
    nodeType.prototype.onDrawForeground = function (ctx) { detachWidgets(this); configureReferenceInputs(this); drawUI(this, ctx); };
    const mouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos) { if (handleClick(this, event, pos)) return true; return mouseDown?.apply(this, arguments); };
    const move = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function(event, pos) {
      this._apesHover = (this._kooPrompter11Hits || []).find(b => pos[0] >= b.x && pos[0] <= b.x+b.w && pos[1] >= b.y && pos[1] <= b.y+b.h);
      this.setDirtyCanvas(true, true); return move?.apply(this, arguments);
    };
    const leave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function() { this._apesHover = null; this.setDirtyCanvas(true, true); return leave?.apply(this, arguments); };
    const key = nodeType.prototype.onKeyDown;
    nodeType.prototype.onKeyDown = function(event) {
      const hits = this._kooPrompter11Hits || [];
      if (event.key === 'Tab' && hits.length) {
        this._apesFocusIndex = ((this._apesFocusIndex ?? -1) + (event.shiftKey ? -1 : 1) + hits.length) % hits.length;
        this._apesFocus = hits[this._apesFocusIndex]; event.preventDefault(); this.setDirtyCanvas(true, true); return true;
      }
      if (['Enter', ' '].includes(event.key) && this._apesFocus) {
        event.preventDefault(); const b = this._apesFocus; return handleClick(this, event, [b.x+b.w/2,b.y+b.h/2]);
      }
      return key?.apply(this, arguments);
    };
    const resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () { const result = resize?.apply(this, arguments); this.setDirtyCanvas(true, true); return result; };
  },
});



// Shared interaction layer for Apes canvas actions and Apes dialogs only.
const interactionStyle = document.createElement('style');
interactionStyle.textContent = `
.apes-dialog button { transition: filter .12s, transform .12s, box-shadow .12s; cursor:pointer; padding:7px 12px; margin:4px; border-radius:6px; }
.apes-dialog button:hover:not(:disabled) { filter:brightness(1.25); box-shadow:0 0 8px var(--apes-accent,#dc8c40); }
.apes-dialog button:active:not(:disabled) { transform:translateY(1px) scale(.98); filter:brightness(1.4); }
.apes-dialog button:focus-visible { outline:2px solid var(--apes-accent,#dc8c40); outline-offset:3px; }
.apes-dialog button:disabled { opacity:.45; cursor:wait; }
`;
document.head.append(interactionStyle);

async function runAction(node, kind, label, action) {
  node._apesBusy ||= {};
  if (node._apesBusy[kind]) return;
  node._apesBusy[kind] = label; node.setDirtyCanvas(true, true);
  try { await action(); }
  catch(error) { setStatus(node, 'error', error.message); }
  finally { delete node._apesBusy[kind]; node.setDirtyCanvas(true, true); }
}
function drawInteractionFeedback(node, ctx, hits, accent, tokens) {
  for (const box of hits) {
    const busy = node._apesBusy?.[box.kind];
    const matches = b => b && b.kind === box.kind && b.field === box.field && b.x === box.x && b.y === box.y;
    const pressed = matches(node._apesPressed), hover = matches(node._apesHover), focus = matches(node._apesFocus);
    if (!busy && !pressed && !hover && !focus && !box.disabled) continue;
    ctx.save();
    if (pressed) ctx.translate(0, 1);
    ctx.shadowColor = accent; ctx.shadowBlur = busy || box.disabled ? 0 : pressed ? 12 : 6;
    drawRound(ctx, box, busy ? tokens.surfaceRaised : hexToRgba(accent, box.disabled ? .04 : pressed ? .28 : .10), box.disabled ? tokens.border : accent, focus ? 3 : 1.5, 6);
    if (busy) drawText(ctx, busy, box.x + box.w/2, box.y + box.h/2, 11, tokens.textMuted, '700', 'center');
    ctx.restore();
  }
}
function actionButton(label, action, busyLabel = 'Working...') {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true; button.textContent = busyLabel;
    try { await action(); }
    finally { button.disabled = false; button.textContent = label; }
  };
  return button;
}
async function installRuntime(node) {
  runtimeDialog(node);
}
function addRuntimeControls(node, panel) {
  panel.style.setProperty('--apes-accent', node.properties?.kooPrompter11Accent || DEFAULT_ACCENT);
  const group = document.createElement('fieldset'), title = document.createElement('legend');
  title.textContent = 'llama.cpp — optional local runtime';
  const status = document.createElement('p'); status.style.overflowWrap = 'anywhere';
  const variants = document.createElement('select');
  for (const [id, label] of [['windows-x64-cpu','CPU — works without a GPU'], ['windows-x64-cuda12','CUDA 12.4 — NVIDIA driver 551.61 or newer'], ['windows-x64-vulkan','Vulkan — compatible GPU driver required']]) {
    const option = document.createElement('option'); option.value = id; option.textContent = label; variants.append(option);
  }
  const localState = () => ({...engineState(node), provider_preset:'llama.cpp', variant:variants.value});
  const update = result => {
    node._apesRuntime = result;
    const progress = result.installation || {};
    const active = ['downloading','extracting','installing'].includes(progress.phase);
    status.textContent = active
      ? `${progress.phase}: ${(progress.downloaded/1048576).toFixed(1)} / ${(progress.total/1048576).toFixed(1)} MiB — ${progress.message}`
      : `${result.available ? result.source + ' — ' + result.path : 'Not Installed'}${progress.message ? ' — ' + progress.message : ''}`;
    node.setDirtyCanvas(true, true);
  };
  const perform = async action => { try { update(await action()); } catch(error) { status.textContent = error.message; } };
  const controls = [];
  const mutation = async action => {
    if (node._apesRuntimeMutation) { status.textContent = 'Runtime operation already in progress.'; return; }
    node._apesRuntimeMutation = true;
    controls.forEach(button => button.disabled = true); variants.disabled = true;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling || !panel.isConnected) return;
      polling = true;
      try { update(await engineApi('runtime-status', localState())); } catch { /* operation reports the error */ }
      finally { polling = false; }
    }, 1000);
    try { await perform(() => engineApi(action, localState())); }
    finally {
      clearInterval(timer); node._apesRuntimeMutation = false;
      controls.forEach(button => button.disabled = false); variants.disabled = false;
    }
  };
  controls.push(
    actionButton('AUTO discovery', () => perform(() => engineApi('runtime-override', {...localState(), llama_server:''})), 'Validating...'),
    actionButton('Select External llama-server', () => browseServer(node, update), 'Opening...'),
    actionButton('Install Local llama.cpp Runtime', () => mutation('runtime-install'), 'Installing...'),
    actionButton('Repair selected managed variant', () => mutation('runtime-repair'), 'Repairing...'),
    actionButton('Remove selected managed variant', () => mutation('runtime-remove'), 'Removing...'),
    actionButton('Refresh status', () => perform(() => engineApi('runtime-status', localState())), 'Refreshing...'));
  group.append(title, status, variants, ...controls);
  const help = document.createElement('p');
  help.textContent = 'Choose your backend explicitly. No models are downloaded. Removal affects only the selected Apes-managed variant; external and legacy runtimes are preserved.';
  group.append(help); panel.append(group);
  perform(() => engineApi('runtime-status', localState()));
}
function addOllamaControls(node, panel) {
  const group = document.createElement('fieldset'), title = document.createElement('legend'), status = document.createElement('p');
  title.textContent = 'Ollama — optional external application'; status.textContent = 'Status: not checked';
  const refresh = async () => {
    try {
      const current = engineState(node);
      const data = await engineApi('ollama-status', {base_url: current.provider_preset === 'Ollama Native' ? current.base_url : 'http://127.0.0.1:11434'});
      status.textContent = `Status: ${data.detected ? 'Detected' : 'Not Detected'}`;
    } catch(error) { status.textContent = error.message; }
  };
  const help = document.createElement('a'); help.textContent = 'Installation Help';
  help.href = 'https://ollama.com/download'; help.target = '_blank'; help.rel = 'noopener noreferrer';
  group.append(title,status,actionButton('Refresh',refresh,'Checking...'),help); panel.append(group);
}

function runtimeDialog(node) {
  const overlay = document.createElement('div'); overlay.className = 'apes-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;background:#0009;display:grid;place-items:center';
  const panel = document.createElement('div'); panel.style.cssText = 'background:#202127;color:#eee;padding:24px;border-radius:12px;width:min(650px,90vw);font:14px system-ui';
  addRuntimeControls(node,panel); panel.append(actionButton('Close', () => overlay.remove())); overlay.append(panel); document.body.append(overlay);
}
function browseServer(node, update) {
  const overlay = document.createElement('div'); overlay.className = 'apes-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:#0009;display:grid;place-items:center';
  const panel = document.createElement('div'); panel.style.cssText = 'background:#202127;color:#eee;padding:24px;border-radius:12px;width:min(650px,90vw);font:14px system-ui';
  const heading = document.createElement('h3'); heading.textContent = 'Select existing llama-server';
  const input = document.createElement('input'); input.placeholder = 'Folder on this ComfyUI computer'; input.style.width = '95%';
  const list = document.createElement('div'); list.style.cssText = 'height:320px;overflow:auto;display:flex;flex-direction:column';
  const status = document.createElement('p'); let parent = '';
  const open = async directory => {
    try {
      const result = await engineApi('browse-server', {...engineState(node), provider_preset:'llama.cpp', directory});
      input.value = result.directory; parent = result.parent; list.replaceChildren(); status.textContent = '';
      for (const entry of result.entries) list.append(actionButton(`${entry.directory ? '📁' : '▤'} ${entry.name}`, async () => {
        if (entry.directory) return open(entry.path);
        try {
          const chosen = await engineApi('runtime-override', {...engineState(node), provider_preset:'llama.cpp', llama_server:entry.path});
          update(chosen); overlay.remove();
        } catch(error) { status.textContent = error.message; }
      }, 'Validating...'));
    } catch(error) { status.textContent = error.message; }
  };
  panel.append(heading,input,actionButton('Open',()=>open(input.value),'Opening...'),actionButton('Up',()=>open(parent),'Opening...'),actionButton('Drives / Root',()=>open(''),'Opening...'),list,status,actionButton('Cancel',()=>overlay.remove()));
  overlay.append(panel); document.body.append(overlay); open('');
}

