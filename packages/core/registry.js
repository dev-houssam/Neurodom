/**
 * NeuroDOM Core — Registry & Identity Resolver
 * Manages all live agent instances and resolves @trait / @family selectors.
 */

export class AgentRegistry {
  constructor() {
    this._agents = new Map(); // id → agent
    this._registerListeners = [];
    this._unregisterListeners = [];
  }

  // ─── Registration ────────────────────────────────────────────────────────

  register(agent) {
    this._agents.set(agent.id, agent);

    // Watch identity changes to refresh dynamic connections
    agent.onIdentityChange(() => this._onIdentityChange(agent));

    this._registerListeners.forEach((cb) => cb(agent));

    if (window.__NEURODOM_DEVTOOLS__) {
      window.__NEURODOM_DEVTOOLS__.onRegister(agent);
    }
  }

  unregister(agent) {
    this._agents.delete(agent.id);
    this._unregisterListeners.forEach((cb) => cb(agent));

    if (window.__NEURODOM_DEVTOOLS__) {
      window.__NEURODOM_DEVTOOLS__.onUnregister(agent);
    }
  }

  // ─── Query ───────────────────────────────────────────────────────────────

  find(filter) {
    return [...this._agents.values()].filter((agent) =>
      this.match(agent, filter)
    );
  }

  findById(id) {
    return this._agents.get(id) || null;
  }

  findByName(name) {
    return [...this._agents.values()].filter((a) => a.def.name === name);
  }

  match(agent, filter) {
    if (!filter) return true;

    if (filter.trait && !agent.identity.traits.includes(filter.trait))
      return false;

    if (filter.family && agent.identity.family !== filter.family) return false;

    if (filter.name && agent.def.name !== filter.name) return false;

    if (filter.visibility && agent.identity.visibility !== filter.visibility)
      return false;

    return true;
  }

  all() {
    return [...this._agents.values()];
  }

  // ─── Observers ──────────────────────────────────────────────────────────

  onRegister(cb) {
    this._registerListeners.push(cb);
    return () => {
      this._registerListeners = this._registerListeners.filter(
        (l) => l !== cb
      );
    };
  }

  onUnregister(cb) {
    this._unregisterListeners.push(cb);
    return () => {
      this._unregisterListeners = this._unregisterListeners.filter(
        (l) => l !== cb
      );
    };
  }

  _onIdentityChange(agent) {
    // Notify resolver to refresh dynamic connections
    if (window.__NEURODOM_KERNEL__) {
      window.__NEURODOM_KERNEL__.resolver.refresh(agent);
    }
  }
}

// ─── IdentityResolver ────────────────────────────────────────────────────────

export class IdentityResolver {
  constructor(registry) {
    this.registry = registry;
    this._dynamicConnections = []; // { selector, target, port }
    this._bound = new Set(); // "agentId:targetId:port"
  }

  // ─── Selector Parsing ───────────────────────────────────────────────────

  parseSelector(str) {
    // @trait(movie)
    const traitMatch = str.match(/^@trait\((.+?)\)$/);
    if (traitMatch) return { type: "selector", filter: { trait: traitMatch[1] } };

    // @family(media)
    const familyMatch = str.match(/^@family\((.+?)\)$/);
    if (familyMatch) return { type: "selector", filter: { family: familyMatch[1] } };

    // @name(MovieCard)
    const nameMatch = str.match(/^@name\((.+?)\)$/);
    if (nameMatch) return { type: "selector", filter: { name: nameMatch[1] } };

    // Plain agent name
    return { type: "direct", name: str };
  }

  // ─── Connection ─────────────────────────────────────────────────────────

  connectDynamic(selectorStr, targetAgent, targetPort) {
    const selector = this.parseSelector(selectorStr);

    // Store for future agents
    this._dynamicConnections.push({ selector, targetAgent, targetPort });

    // Connect existing agents
    const agents = this.resolve(selector);
    agents.forEach((agent) => this._bind(agent, targetAgent, targetPort));

    // Watch for new agents
    this.registry.onRegister((agent) => {
      if (this._matches(agent, selector)) {
        this._bind(agent, targetAgent, targetPort);
      }
    });
  }

  resolve(selector) {
    if (selector.type === "selector") {
      return this.registry.find(selector.filter);
    }
    if (selector.type === "direct") {
      return this.registry.findByName(selector.name);
    }
    return [];
  }

  refresh(agent) {
    this._dynamicConnections.forEach(({ selector, targetAgent, targetPort }) => {
      if (this._matches(agent, selector)) {
        this._bind(agent, targetAgent, targetPort);
      }
    });
  }

  _matches(agent, selector) {
    if (selector.type === "selector") {
      return this.registry.match(agent, selector.filter);
    }
    if (selector.type === "direct") {
      return agent.def.name === selector.name;
    }
    return false;
  }

  _bind(sourceAgent, targetAgent, targetPort) {
    const key = `${sourceAgent.id}:${targetAgent.id}:${targetPort}`;
    if (this._bound.has(key)) return;
    this._bound.add(key);

    sourceAgent.on(targetPort, (data) => {
      targetAgent.receive(targetPort, data);
    });
  }
}
