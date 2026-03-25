/**
 * NeuroDOM Core — UI Batcher & UIAPI
 * Batches all DOM mutations into a single rAF flush to avoid layout thrashing.
 */

export class UIBatcher {
  constructor() {
    this._queue = [];
    this._keyed = new Map(); // key → action (last write wins)
    this._scheduled = false;
  }

  enqueue(action, key = null) {
    if (key) {
      this._keyed.set(key, action);
    } else {
      this._queue.push(action);
    }

    if (!this._scheduled) {
      this._scheduled = true;
      requestAnimationFrame(() => this._flush());
    }
  }

  _flush() {
    // Run keyed (deduplicated) mutations first
    this._keyed.forEach((action) => action());
    this._keyed.clear();

    // Then sequential mutations
    const batch = this._queue.splice(0);
    batch.forEach((action) => action());

    this._scheduled = false;
  }
}

// Shared global batcher instance
export const globalBatcher = new UIBatcher();

// ─── UIAPI ───────────────────────────────────────────────────────────────────

export class UIAPI {
  /**
   * @param {HTMLElement} root  The agent's root DOM element
   * @param {UIBatcher}   batcher
   * @param {Agent}       agent  Back-reference for UI events
   */
  constructor(root, batcher, agent) {
    this._root = root;
    this._batcher = batcher;
    this._agent = agent;
    this._uiListeners = {}; // event → cleanup fn
    this._attachUIListeners();
  }

  // ─── Selectors ──────────────────────────────────────────────────────────

  $(selector) {
    return selector ? this._root.querySelector(selector) : this._root;
  }

  $$(selector) {
    return [...this._root.querySelectorAll(selector)];
  }

  getRect() {
    return this._root.getBoundingClientRect();
  }

  // ─── Content ────────────────────────────────────────────────────────────

  setText(selector, value) {
    this._batcher.enqueue(
      () => {
        const el = this.$(selector);
        if (el) el.textContent = String(value);
      },
      `text:${this._agent.id}:${selector}`
    );
  }

  setHTML(selector, value) {
    this._batcher.enqueue(
      () => {
        const el = this.$(selector);
        if (el) el.innerHTML = value;
      },
      `html:${this._agent.id}:${selector}`
    );
  }

  setAttr(selector, name, value) {
    this._batcher.enqueue(
      () => {
        const el = this.$(selector);
        if (el) el.setAttribute(name, value);
      },
      `attr:${this._agent.id}:${selector}:${name}`
    );
  }

  // ─── CSS Classes ────────────────────────────────────────────────────────

  addClass(selector, cls) {
    this._batcher.enqueue(() => this.$(selector)?.classList.add(cls));
  }

  removeClass(selector, cls) {
    this._batcher.enqueue(() => this.$(selector)?.classList.remove(cls));
  }

  toggleClass(selector, cls, force) {
    this._batcher.enqueue(() =>
      this.$(selector)?.classList.toggle(cls, force)
    );
  }

  // ─── Style ──────────────────────────────────────────────────────────────

  setStyle(selector, prop, value) {
    this._batcher.enqueue(
      () => {
        const el = this.$(selector);
        if (el) el.style[prop] = value;
      },
      `style:${this._agent.id}:${selector}:${prop}`
    );
  }

  // ─── Transform (keyed = deduped per frame) ───────────────────────────────

  scale(value, selector = null) {
    const key = `scale:${this._agent.id}:${selector || "root"}`;
    this._batcher.enqueue(() => {
      const el = this.$(selector);
      if (el) el.style.transform = `scale(${value})`;
    }, key);
  }

  moveTo(x, y, selector = null) {
    const key = `move:${this._agent.id}:${selector || "root"}`;
    this._batcher.enqueue(() => {
      const el = this.$(selector);
      if (el) el.style.transform = `translate(${x}px, ${y}px)`;
    }, key);
  }

  moveToward(target, selector = null, speed = 0.1) {
    const key = `moveToward:${this._agent.id}:${selector || "root"}`;
    this._batcher.enqueue(() => {
      const el = this.$(selector);
      if (!el || !target) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (target.x - cx) * speed;
      const dy = (target.y - cy) * speed;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }, key);
  }

  // ─── Visibility ──────────────────────────────────────────────────────────

  show(selector = null) {
    this._batcher.enqueue(
      () => {
        const el = this.$(selector);
        if (el) el.style.display = "";
      },
      `vis:${this._agent.id}:${selector}`
    );
  }

  hide(selector = null) {
    this._batcher.enqueue(
      () => {
        const el = this.$(selector);
        if (el) el.style.display = "none";
      },
      `vis:${this._agent.id}:${selector}`
    );
  }

  toggle(selector = null) {
    this._batcher.enqueue(() => {
      const el = this.$(selector);
      if (!el) return;
      el.style.display = el.style.display === "none" ? "" : "none";
    });
  }

  // ─── Dynamic children ────────────────────────────────────────────────────

  create(tagName) {
    const el = document.createElement(tagName);
    return el;
  }

  append(child, selector = null) {
    this._batcher.enqueue(() => {
      const parent = this.$(selector);
      if (parent && child) parent.appendChild(child);
    });
  }

  remove(child) {
    this._batcher.enqueue(() => child?.remove());
  }

  clear(selector = null) {
    this._batcher.enqueue(() => {
      const el = this.$(selector);
      if (el) el.innerHTML = "";
    });
  }

  // ─── UI Events (attached once, dispatch to kernel) ───────────────────────

  _attachUIListeners() {
    const map = {
      "ui.click": "click",
      "ui.hover": "mouseenter",
      "ui.leave": "mouseleave",
      "ui.input": "input",
      "ui.focus": "focus",
      "ui.blur": "blur",
    };

    Object.entries(map).forEach(([ndEvent, domEvent]) => {
      const handler = (e) => {
        if (window.__NEURODOM_KERNEL__) {
          window.__NEURODOM_KERNEL__.schedule(this._agent, {
            type: ndEvent,
            payload: { originalEvent: e, target: e.target },
          });
        }
      };
      this._root.addEventListener(domEvent, handler);
      this._uiListeners[ndEvent] = () =>
        this._root.removeEventListener(domEvent, handler);
    });
  }

  detach() {
    Object.values(this._uiListeners).forEach((cleanup) => cleanup());
  }
}
