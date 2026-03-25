/**
 * NeuroDOM Core — Kernel
 * The central runtime that ties together scheduler, registry, resolver, and graph.
 */

import { Scheduler } from "./scheduler.js";
import { AgentRegistry, IdentityResolver } from "./registry.js";
import { UIAPI, globalBatcher } from "./ui.js";
import { Agent } from "./agent.js";

export class Kernel {
  constructor() {
    this.scheduler = new Scheduler();
    this.registry = new AgentRegistry();
    this.resolver = new IdentityResolver(this.registry);

    // Graph connections: { from: "AgentName.port", to: "AgentName.port" }[]
    this._graphConnections = [];

    // Interval handles
    this._intervals = new Map();

    // Install self globally so agents/scheduler can reach kernel
    window.__NEURODOM_KERNEL__ = this;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  start() {
    this.scheduler.start();
  }

  stop() {
    this.scheduler.stop();
    this._intervals.forEach((id) => clearInterval(id));
  }

  // ─── Agent instantiation ─────────────────────────────────────────────────

  instantiate(definition, element) {
    const agent = new Agent(definition, element);

    // Inject UI API
    agent.ui = new UIAPI(element, globalBatcher, agent);

    // Render template into element
    if (definition.template) {
      element.innerHTML =
        typeof definition.template === "function"
          ? definition.template({})
          : definition.template;
    }

    this.registry.register(agent);

    // Wire pending graph connections to/from this agent
    this._wireAgent(agent);

    // Mount lifecycle event
    agent.mount();

    // Setup intervals if definition declares them
    if (definition.intervals) {
      definition.intervals.forEach(({ ms }) => this._setupInterval(agent, ms));
    }

    return agent;
  }

  // ─── Graph connections ───────────────────────────────────────────────────

  /**
   * Connect two agent ports.
   * Supports:
   *   "MovieCard.hover" → "PreviewPlayer.movie"
   *   "@trait(movie).hover" → "PreviewPlayer.movie"
   */
  connect(fromStr, toStr) {
    this._graphConnections.push({ from: fromStr, to: toStr });

    const [fromAgent, fromPort] = this._parseRef(fromStr);
    const [toAgent, toPort] = this._parseRef(toStr);

    // Resolve target agents now (must exist)
    const targets = this._resolveAgents(toAgent);

    if (fromAgent.startsWith("@")) {
      // Dynamic selector
      targets.forEach((target) => {
        this.resolver.connectDynamic(fromAgent, target, fromPort);
      });
    } else {
      // Direct connection — may not exist yet, so use registry observer
      const doConnect = () => {
        const sources = this.registry.findByName(fromAgent);
        const tgts = this._resolveAgents(toAgent);

        sources.forEach((src) => {
          tgts.forEach((tgt) => {
            src.on(fromPort, (data) => tgt.receive(toPort, data));
          });
        });
      };

      doConnect();

      // Also wire any future agents of this name
      this.registry.onRegister((agent) => {
        if (agent.def.name === fromAgent) {
          const tgts = this._resolveAgents(toAgent);
          tgts.forEach((tgt) => {
            agent.on(fromPort, (data) => tgt.receive(toPort, data));
          });
        }
        if (agent.def.name === toAgent) {
          const srcs = this.registry.findByName(fromAgent);
          srcs.forEach((src) => {
            src.on(fromPort, (data) => agent.receive(toPort, data));
          });
        }
      });
    }
  }

  _wireAgent(agent) {
    this._graphConnections.forEach(({ from, to }) => {
      const [fromAgent, fromPort] = this._parseRef(from);
      const [toAgent, toPort] = this._parseRef(to);

      if (fromAgent === agent.def.name) {
        const targets = this.registry.findByName(toAgent);
        targets.forEach((tgt) => {
          agent.on(fromPort, (data) => tgt.receive(toPort, data));
        });
      }

      if (toAgent === agent.def.name) {
        const sources = this.registry.findByName(fromAgent);
        sources.forEach((src) => {
          src.on(fromPort, (data) => agent.receive(toPort, data));
        });
      }
    });
  }

  _parseRef(ref) {
    const dot = ref.lastIndexOf(".");
    return [ref.slice(0, dot), ref.slice(dot + 1)];
  }

  _resolveAgents(nameOrSelector) {
    if (nameOrSelector.startsWith("@")) {
      const sel = this.resolver.parseSelector(nameOrSelector);
      return this.resolver.resolve(sel);
    }
    return this.registry.findByName(nameOrSelector);
  }

  // ─── Intervals ──────────────────────────────────────────────────────────

  _setupInterval(agent, ms) {
    const id = setInterval(() => {
      this.schedule(agent, { type: `interval.${ms}`, payload: { ms } });
    }, ms);
    this._intervals.set(`${agent.id}:${ms}`, id);
  }

  // ─── Scheduling (delegates to scheduler) ─────────────────────────────────

  schedule(agent, event) {
    this.scheduler.schedule(agent, event);
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  getStats() {
    return {
      agents: this.registry.all().length,
      scheduler: this.scheduler.getStats(),
      connections: this._graphConnections.length,
    };
  }
}
