import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const newSource = fs.readFileSync(new URL("web/apes_prompter11/koo_apes_prompter11.js", root), "utf8");
const oldSource = fs.readFileSync(new URL("../koo-nodes-pack/web/visual_prompt_director/koo_visual_prompt_director.js", root), "utf8");
const token = new Proxy({}, {get: () => "#ffffff"});
const extensionContext = (source) => {
  let extension;
  const elements = [];
  const context = {
    app: {registerExtension: e => extension = e},
    api: {fetchApi: async () => ({ok: true, json: async () => ({ok: true, presets: {}, models: []})})},
    DEFAULT_ACCENT: "#ff00aa", SWATCHES: [], THEMES: ["Dark"], THEME_TOKENS: {Dark: token},
    activeFill: () => "#ffffff", activeForeground: () => "#ffffff", buildAccentPalette: () => token,
    drawPaletteIcon: () => {}, drawRound: () => {}, drawText: () => {}, ellipsize: (ctx, value) => value,
    hexToRgba: () => "#ffffff", normalizeHex: value => value,
    URLSearchParams, URL, setTimeout, setInterval, clearInterval, console,
    document: { createElement: tag => {
      const element = {tag, children:[], style:{setProperty(name,value) {this[name]=value;}}, classList:{add() {}},
        append(...children) {this.children.push(...children);}, addEventListener() {}, isConnected:true};
      elements.push(element); return element;
    }, head:{appendChild() {},append() {}} },
  };
  vm.createContext(context);
  vm.runInContext(source.replace(/^import[\s\S]*?;\s*/gm, "") + "\nglobalThis.testApi = {WIDGET_NAMES, state, makeLayout, textOnlyPayload, runAction: typeof runAction === 'undefined' ? null : runAction, actionButton: typeof actionButton === 'undefined' ? null : actionButton, addRuntimeControls: typeof addRuntimeControls === 'undefined' ? null : addRuntimeControls, engineState: typeof engineState === 'undefined' ? null : engineState};", context);
  return {extension, api: context.testApi, context, elements};
};
const current = extensionContext(newSource);
const original = extensionContext(oldSource);
function TestNode() { this.widgets = []; this.properties = {}; this.inputs = []; this.size = [460, 450]; }
TestNode.prototype.serialize = function () { return {type: this.type, properties: this.properties}; };
TestNode.prototype.setDirtyCanvas = function () {};
const untouched = TestNode.prototype.serialize;
current.extension.beforeRegisterNodeDef(TestNode, {name: "KoOVisualPromptDirector"});
assert.equal(TestNode.prototype.serialize, untouched, "new extension must ignore original class");
current.extension.beforeRegisterNodeDef(TestNode, {name: "KoOApesPrompter11"});
const wrapped = TestNode.prototype.serialize;
original.extension.beforeRegisterNodeDef(TestNode, {name: "KoOApesPrompter11"});
assert.equal(TestNode.prototype.serialize, wrapped, "old extension must ignore new class");
const node = new TestNode();
node.type = "KoOApesPrompter11";
node.widgets = Array.from(current.api.WIDGET_NAMES, name => ({name, value: ""}));
node.widgets.find(w => w.name === "provider_preset").value = "LM Studio";
node.widgets.find(w => w.name === "engine_model").value = "manual/model-id";
node.widgets.find(w => w.name === "base_url").value = "http://192.168.1.50:1234/v1";
node.onNodeCreated();
node._temporarySecretTest = "NOT-A-REAL-KEY";
const saved = node.serialize();
assert.equal(saved.type, "KoOApesPrompter11");
assert.equal(saved.widgets_values[current.api.WIDGET_NAMES.indexOf("engine_model")], "manual/model-id");
assert.ok(!JSON.stringify(saved).includes("NOT-A-REAL-KEY"));
assert.ok(!current.api.WIDGET_NAMES.includes("api_key"));
assert.equal(node.properties.kooPrompter11AdvancedOpen, false);
assert.ok(!Object.keys(node.properties).some(key => key.startsWith("kooPromptDirector")));
const payload = current.api.textOnlyPayload(current.api.state(node));
assert.equal(payload.engine_model, "manual/model-id");
assert.equal(payload.provider_preset, "LM Studio");
assert.equal(payload.base_url, "http://192.168.1.50:1234/v1");
assert.ok(!Object.hasOwn(payload, "api_key"));
const closed = current.api.makeLayout(node);
assert.ok(closed.hits.some(hit => hit.kind === "testConnection"));
assert.ok(closed.hits.some(hit => hit.kind === "engineModel"));
assert.ok(!closed.hits.some(hit => hit.kind === "engineSettings"));
node.properties.kooPrompter11AdvancedOpen = true;
const open = current.api.makeLayout(node);
assert.ok(open.hits.some(hit => hit.kind === "engineSettings"));
const ctx = new Proxy({measureText: value => ({width: String(value).length * 6})}, {get: (target, key) => target[key] || (() => {})});
node.onDrawForeground(ctx);
const restored = new TestNode(); restored.type = "KoOApesPrompter11";
restored.widgets = Array.from(current.api.WIDGET_NAMES, name => ({name, value: ""}));
restored.onConfigure(saved);
assert.deepEqual(restored.serialize().widgets_values, saved.widgets_values);
assert.ok(newSource.includes('secretInput.type = "password"'));
assert.ok(!newSource.includes("localStorage"));
console.log("PASS: frontend guards, old/new coexistence, engine payload, drawing, advanced controls, serialization and reload");

// The independent runtime panel fix must work with the original Legacy UI.
const panel = {style:{setProperty() {}},children:[],append(...children) {this.children.push(...children);},isConnected:true};
assert.doesNotThrow(() => current.api.addRuntimeControls(node,panel));
assert.equal(panel.children[0].tag,"fieldset");
assert.equal(panel.children[0].children.filter(el=>el.tag==="button").length,6);
let release, calls=0;
const pending=new Promise(resolve=>{release=resolve;});
const first=current.api.runAction(node,"testConnection","Testing...",async()=>{calls++;await pending;});
await current.api.runAction(node,"testConnection","Testing...",async()=>{calls++;});
assert.equal(calls,1); assert.equal(node._apesBusy.testConnection,"Testing...");
release(); await first; assert.equal(node._apesBusy.testConnection,undefined);
let releaseButton, buttonCalls=0;
const buttonPending=new Promise(resolve=>{releaseButton=resolve;});
const button=current.api.actionButton("Install",async()=>{buttonCalls++;await buttonPending;},"Installing...");
const buttonFirst=button.onclick();await button.onclick();assert.equal(buttonCalls,1);assert.equal(button.disabled,true);
releaseButton();await buttonFirst;assert.equal(button.disabled,false);assert.equal(button.textContent,"Install");
console.log("PASS: independent runtime panel fix, six original runtime controls, busy-state and repeated-click protection retained");
