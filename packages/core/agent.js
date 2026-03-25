/**
 * NeuroDOM Core — Agent
 * An agent is an autonomous, reactive, communicating entity.
 */

export class Agent {
  constructor(definition, element) {
    this.def = definition;
    this.el = element;

    this.id = `${definition.name}:${crypto.randomUUID().slice(0, 8)}`;

    // Identity system
    this.identity = {
      traits: [...(definition.identity?.traits || [])],
      family: definition.identity?.family || null,
      visibility: definition.identity?.visibility || "public",
    };

    // Port buffers
    this.input = {};
    this.output = {};

    // State (clone from definition factory)
    this.state =
      typeof definition.state === "function" ? definition.state() : {};

    // Runtime metadata
    this.status = "idle"; // idle | scheduled | running | cooldown
    this.energy = 0;
    this.lastRun = 0;
    this.activeUntil = 0;

    // Event listeners (output port → callbacks)
    this._listeners = {};

    // Identity change listeners
    this._identityListeners = [];

    // UI API (injected by runtime)
    this.ui = null;

    // Emit function (injected by runtime)
    this.emit = this._createEmitter();
  }

  // ─── Identity ───────────────────────────────────────────────────────────

  addTrait(trait) {
    if (!this.identity.traits.includes(trait)) {
      this.identity.traits.push(trait);
      this._notifyIdentityChange();
    }
    return this;
  }

  removeTrait(trait) {
    this.identity.traits = this.identity.traits.filter((t) => t !== trait);
    this._notifyIdentityChange();
    return this;
  }

  hasTrait(trait) {
    return this.identity.traits.includes(trait);
  }

  onIdentityChange(cb) {
    this._identityListeners.push(cb);
    return () => {
      this._identityListeners = this._identityListeners.filter(
        (l) => l !== cb
      );
    };
  }

  _notifyIdentityChange() {
    this._identityListeners.forEach((cb) => cb(this));
  }

  // ─── Ports ──────────────────────────────────────────────────────────────

  receive(portName, data) {
    this.input[portName] = data;

    // Dispatch an input event to the pipeline engine
    this._dispatch({ type: `input.${portName}`, payload: data });
  }

  on(portName, callback) {
    if (!this._listeners[portName]) this._listeners[portName] = [];
    this._listeners[portName].push(callback);

    // Return unsubscribe
    return () => {
      this._listeners[portName] = this._listeners[portName].filter(
        (cb) => cb !== callback
      );
    };
  }

  _createEmitter() {
    return (portName, data) => {
      const callbacks = this._listeners[portName] || [];
      callbacks.forEach((cb) => cb(data));

      // DevTools hook
      if (window.__NEURODOM_DEVTOOLS__) {
        window.__NEURODOM_DEVTOOLS__.onEmit(this, portName, data);
      }
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  mount() {
    this._dispatch({ type: "lifecycle.mount", payload: null });
  }

  destroy() {
    this._dispatch({ type: "lifecycle.destroy", payload: null });
    this.status = "idle";
  }

  // ─── Execution ──────────────────────────────────────────────────────────

  _dispatch(event) {
    // Delegate to global kernel scheduler
    if (window.__NEURODOM_KERNEL__) {
      window.__NEURODOM_KERNEL__.schedule(this, event);
    }
  }

  run(event) {
    if (!this.def.flows) return;

    this.status = "running";
    this.energy += 1;
    this.lastRun = Date.now();

    const ctx = this._createContext(event);

    // Run all flows that match this event source
    this.def.flows.forEach((flow) => {
      FlowExecutor.run(flow, ctx, event);
    });

    // DevTools hook
    if (window.__NEURODOM_DEVTOOLS__) {
      window.__NEURODOM_DEVTOOLS__.onRun(this, event, ctx.state);
    }
  }

  _createContext(event) {
    return {
      input: this.input,
      state: this.state,
      local: {},
      event,
      ui: this.ui,
      emit: this.emit,
      self: this,
    };
  }

  // ─── Serialization ──────────────────────────────────────────────────────

  toJSON() {
    return {
      id: this.id,
      name: this.def.name,
      identity: this.identity,
      status: this.status,
      inputs: Object.keys(this.def.inputs || {}),
      outputs: Object.keys(this.def.outputs || {}),
      state: this.state,
    };
  }
}

// ─── FlowExecutor ────────────────────────────────────────────────────────────

export class FlowExecutor {
  static run(flow, ctx, event) {
    flow.pipelines.forEach((pipeline) => {
      FlowExecutor.executePipeline(pipeline, ctx, event);
    });
  }

  static executePipeline(pipeline, ctx, event) {
    // Resolve source(s)
    let value;

    if (Array.isArray(pipeline.sources)) {
      // Multi-input: wait for all
      const values = pipeline.sources.map((src) =>
        FlowExecutor.resolveSource(src, ctx, event)
      );
      if (values.some((v) => v === undefined || v === null)) return;
      value = values;
    } else {
      // Check if this pipeline matches the current event
      const sourceKey = FlowExecutor.eventToSource(event);
      if (pipeline.source !== sourceKey && pipeline.source !== "*") return;

      value = FlowExecutor.resolveSource(pipeline.source, ctx, event);
    }

    if (value === undefined) return;

    // Condition guard
    if (pipeline.condition && !pipeline.condition(ctx, value)) return;

    ctx.current = value;

    // Execute steps
    for (const step of pipeline.steps) {
      const result = FlowExecutor.executeStep(step, ctx);
      if (result === "STOP") return;
    }
  }

  static resolveSource(source, ctx, event) {
    if (source === "*") return event.payload;

    if (source.startsWith("input.")) {
      return ctx.input[source.slice(6)];
    }
    if (source.startsWith("state.")) {
      return ctx.state[source.slice(6)];
    }
    if (source === "lifecycle.mount" || source === "lifecycle.destroy") {
      return event.type === source ? true : undefined;
    }
    if (source.startsWith("ui.")) {
      return event.type === source ? event.payload : undefined;
    }
    if (source.startsWith("interval")) {
      return event.type === source ? event.payload : undefined;
    }
    if (ctx.local[source] !== undefined) {
      return ctx.local[source];
    }
    return undefined;
  }

  static eventToSource(event) {
    return event.type;
  }

  static executeStep(step, ctx) {
    switch (step.type) {
      case "fn":
        ctx.current = FunctionRegistry.call(step.name, ctx, ...(step.args || []));
        break;

      case "assign":
        if (step.target.startsWith("state.")) {
          ctx.state[step.target.slice(6)] = ctx.current;
        } else {
          ctx.local[step.target] = ctx.current;
        }
        break;

      case "ui":
        if (ctx.ui && typeof ctx.ui[step.action] === "function") {
          ctx.ui[step.action](...(step.args || []));
        }
        break;

      case "emit":
        ctx.emit(step.port, step.value !== undefined ? step.value : ctx.current);
        break;

      case "multi-emit":
        for (const [port, val] of Object.entries(step.outputs)) {
          ctx.emit(port, val);
        }
        break;

      case "filter":
        if (!Array.isArray(ctx.current)) return "STOP";
        ctx.current = ctx.current.filter(step.fn);
        break;

      case "map":
        if (!Array.isArray(ctx.current)) return "STOP";
        ctx.current = ctx.current.map(step.fn);
        break;

      case "condition":
        if (!step.fn(ctx.current)) return "STOP";
        break;

      case "match": {
        const key = ctx.current;
        const branch = step.cases[key] || step.cases["default"];
        if (branch) branch.forEach((s) => FlowExecutor.executeStep(s, ctx));
        return "STOP";
      }

      case "log":
        console.log(`[NeuroDOM:${ctx.self?.def?.name}]`, ctx.current);
        break;

      case "raw":
        step.fn(ctx);
        break;
    }
    return null;
  }
}

// ─── FunctionRegistry ────────────────────────────────────────────────────────

export const FunctionRegistry = {
  _fns: {
    distance(ctx, target) {
      if (!ctx.ui || !target) return Infinity;
      const rect = ctx.ui.getRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.sqrt(Math.pow((target.x || 0) - cx, 2) + Math.pow((target.y || 0) - cy, 2));
    },

    enrich(ctx, data) {
      return { ...data, _enriched: true, _ts: Date.now() };
    },

    merge(ctx, ...args) {
      if (Array.isArray(args[0])) {
        return Object.assign({}, ...args[0]);
      }
      return Object.assign({}, ...args);
    },

    log(ctx, label) {
      console.log(`[flow:${label || "log"}]`, ctx.current);
      return ctx.current;
    },
  },

  register(name, fn) {
    this._fns[name] = fn;
  },

  call(name, ctx, ...args) {
    if (!this._fns[name]) {
      console.warn(`[NeuroDOM] Unknown function: ${name}`);
      return ctx.current;
    }
    return this._fns[name](ctx, ...args);
  },
};
