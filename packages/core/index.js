/**
 * NeuroDOM Core — createApp
 * Entry point for browser applications.
 */

import { Kernel } from "./kernel.js";

export { Agent, FlowExecutor, FunctionRegistry } from "./agent.js";
export { Scheduler } from "./scheduler.js";
export { AgentRegistry, IdentityResolver } from "./registry.js";
export { UIAPI, UIBatcher, globalBatcher } from "./ui.js";
export { Kernel } from "./kernel.js";

// ─── createApp ───────────────────────────────────────────────────────────────

export function createApp(rootDefinition) {
  const kernel = new Kernel();

  const app = {
    _kernel: kernel,
    _plugins: [],

    use(plugin) {
      this._plugins.push(plugin);
      if (typeof plugin.install === "function") {
        plugin.install(kernel);
      }
      return this;
    },

    mount(selector) {
      const el =
        typeof selector === "string"
          ? document.querySelector(selector)
          : selector;

      if (!el) {
        throw new Error(`[NeuroDOM] Mount target not found: ${selector}`);
      }

      // Resolve and register all agent definitions from the DOM
      _hydrateDOM(el, kernel, rootDefinition);

      kernel.start();

      return this;
    },

    unmount() {
      kernel.stop();
      kernel.registry.all().forEach((a) => a.destroy());
    },

    get kernel() {
      return kernel;
    },
  };

  return app;
}

// ─── DOM Hydration ───────────────────────────────────────────────────────────

function _hydrateDOM(root, kernel, rootDef) {
  // Register the root definition
  _registerDefinition(rootDef, kernel);

  // Walk DOM and instantiate custom elements
  _walkAndInstantiate(root, kernel);
}

function _registerDefinition(def, kernel) {
  if (!def || !def.name) return;

  // Store definition in global registry by tag name
  const tagName = _toKebab(def.name);
  window.__NEURODOM_DEFS__ = window.__NEURODOM_DEFS__ || {};
  window.__NEURODOM_DEFS__[tagName] = def;

  // Register sub-components
  (def.components || []).forEach((subDef) => _registerDefinition(subDef, kernel));
}

function _walkAndInstantiate(root, kernel) {
  // Find all custom elements (contain a hyphen)
  const customEls = root.querySelectorAll("*");

  customEls.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (!tag.includes("-")) return;
    if (el.__nrd_agent) return; // already instantiated

    const def = window.__NEURODOM_DEFS__?.[tag];
    if (!def) return;

    const agent = kernel.instantiate(def, el);
    el.__nrd_agent = agent;
  });
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function _toKebab(str) {
  return str
    .replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
    .replace(/^-/, "");
}
