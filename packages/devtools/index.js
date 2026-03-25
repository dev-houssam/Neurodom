/**
 * NeuroDOM DevTools
 * Injects a floating panel showing the live agent graph, events, and state.
 */

export class NeuroDevTools {
  constructor() {
    this._agents = new Map();
    this._events = [];
    this._maxEvents = 100;
    this._panel = null;
    this._visible = false;
    this._graphCanvas = null;
    this._ctx = null;
    this._connections = [];
    this._rafId = null;

    // Install global hook
    window.__NEURODOM_DEVTOOLS__ = this;
  }

  // ─── Hooks (called by Kernel/Agent) ──────────────────────────────────────

  onRegister(agent) {
    this._agents.set(agent.id, {
      agent,
      emits: 0,
      lastEvent: null,
    });
    this._render();
  }

  onUnregister(agent) {
    this._agents.delete(agent.id);
    this._render();
  }

  onRun(agent, event, state) {
    const entry = this._agents.get(agent.id);
    if (entry) {
      entry.lastEvent = event.type;
      entry.state = { ...state };
    }

    this._events.unshift({
      ts: Date.now(),
      agentId: agent.id,
      agentName: agent.def.name,
      event: event.type,
    });

    if (this._events.length > this._maxEvents) {
      this._events.length = this._maxEvents;
    }

    this._render();
  }

  onEmit(agent, port, data) {
    const entry = this._agents.get(agent.id);
    if (entry) entry.emits++;

    this._events.unshift({
      ts: Date.now(),
      agentId: agent.id,
      agentName: agent.def.name,
      event: `emit:${port}`,
      data: typeof data === "object" ? JSON.stringify(data).slice(0, 60) : String(data),
    });

    if (this._events.length > this._maxEvents) {
      this._events.length = this._maxEvents;
    }

    this._render();
  }

  // ─── Mount ───────────────────────────────────────────────────────────────

  install() {
    if (this._panel) return;
    this._injectStyles();
    this._buildPanel();
    document.body.appendChild(this._panel);

    // Toggle with Ctrl+Shift+D
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        this.toggle();
      }
    });

    this._startGraphLoop();
    return this;
  }

  toggle() {
    this._visible = !this._visible;
    this._panel.style.transform = this._visible
      ? "translateX(0)"
      : "translateX(100%)";
  }

  // ─── Panel HTML ──────────────────────────────────────────────────────────

  _buildPanel() {
    this._panel = document.createElement("div");
    this._panel.id = "__nrd-devtools__";
    this._panel.innerHTML = `
      <div class="nrd-dt-header">
        <span class="nrd-dt-logo">⬡ NeuroDOM DevTools</span>
        <div class="nrd-dt-tabs">
          <button class="nrd-tab active" data-tab="graph">Graph</button>
          <button class="nrd-tab" data-tab="agents">Agents</button>
          <button class="nrd-tab" data-tab="events">Events</button>
        </div>
        <button class="nrd-dt-close" id="nrd-close">✕</button>
      </div>

      <div class="nrd-dt-body">
        <div class="nrd-tab-content active" data-content="graph">
          <canvas id="nrd-graph-canvas" width="340" height="280"></canvas>
          <div class="nrd-graph-legend">
            <span class="nrd-dot nrd-dot-idle"></span> idle
            <span class="nrd-dot nrd-dot-running"></span> running
            <span class="nrd-dot nrd-dot-cooldown"></span> cooldown
          </div>
        </div>

        <div class="nrd-tab-content" data-content="agents">
          <div id="nrd-agents-list"></div>
        </div>

        <div class="nrd-tab-content" data-content="events">
          <div id="nrd-events-list"></div>
        </div>
      </div>

      <div class="nrd-dt-footer">
        <span id="nrd-stats">0 agents · 0 events</span>
      </div>
    `;

    // Tabs
    this._panel.querySelectorAll(".nrd-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._panel.querySelectorAll(".nrd-tab").forEach((b) => b.classList.remove("active"));
        this._panel.querySelectorAll(".nrd-tab-content").forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        this._panel.querySelector(`[data-content="${btn.dataset.tab}"]`).classList.add("active");
      });
    });

    // Close button
    this._panel.querySelector("#nrd-close").addEventListener("click", () => this.toggle());

    // Graph canvas
    this._graphCanvas = this._panel.querySelector("#nrd-graph-canvas");
    this._ctx = this._graphCanvas.getContext("2d");
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  _render() {
    this._renderAgents();
    this._renderEvents();
    this._renderStats();
  }

  _renderAgents() {
    const list = this._panel?.querySelector("#nrd-agents-list");
    if (!list) return;

    list.innerHTML = [...this._agents.values()]
      .map(({ agent, emits, lastEvent, state }) => `
        <div class="nrd-agent-row">
          <span class="nrd-status-dot nrd-status-${agent.status}"></span>
          <div class="nrd-agent-info">
            <strong>${agent.def.name}</strong>
            <span class="nrd-agent-id">${agent.id}</span>
            ${agent.identity.traits.length ? `<div class="nrd-traits">${agent.identity.traits.map((t) => `<span class="nrd-trait">${t}</span>`).join("")}</div>` : ""}
            ${lastEvent ? `<div class="nrd-last-event">${lastEvent}</div>` : ""}
            ${state && Object.keys(state).length ? `<div class="nrd-state">${JSON.stringify(state).slice(0, 80)}</div>` : ""}
          </div>
          <span class="nrd-emit-count">${emits} ↑</span>
        </div>
      `)
      .join("");
  }

  _renderEvents() {
    const list = this._panel?.querySelector("#nrd-events-list");
    if (!list) return;

    list.innerHTML = this._events
      .slice(0, 30)
      .map(
        ({ ts, agentName, event, data }) => `
        <div class="nrd-event-row">
          <span class="nrd-event-time">${new Date(ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          <span class="nrd-event-agent">${agentName}</span>
          <span class="nrd-event-type ${event.startsWith("emit") ? "nrd-emit" : "nrd-input"}">${event}</span>
          ${data ? `<span class="nrd-event-data">${data}</span>` : ""}
        </div>
      `
      )
      .join("");
  }

  _renderStats() {
    const el = this._panel?.querySelector("#nrd-stats");
    if (!el) return;
    el.textContent = `${this._agents.size} agents · ${this._events.length} events`;
  }

  // ─── Graph canvas ────────────────────────────────────────────────────────

  _startGraphLoop() {
    const draw = () => {
      this._drawGraph();
      this._rafId = requestAnimationFrame(draw);
    };
    draw();
  }

  _drawGraph() {
    const canvas = this._graphCanvas;
    const ctx = this._ctx;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const agents = [...this._agents.values()];
    if (agents.length === 0) {
      ctx.fillStyle = "#555";
      ctx.font = "13px monospace";
      ctx.fillText("No agents registered yet.", 20, 40);
      return;
    }

    // Layout agents in a circle
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 40;
    const positions = {};

    agents.forEach(({ agent }, i) => {
      const angle = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
      positions[agent.id] = {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        agent,
      };
    });

    // Draw connections from kernel graph
    if (window.__NEURODOM_KERNEL__) {
      const conns = window.__NEURODOM_KERNEL__._graphConnections;
      conns.forEach(({ from, to }) => {
        const fromName = from.split(".")[0];
        const toName = to.split(".")[0];

        const srcEntry = agents.find((a) => a.agent.def.name === fromName);
        const tgtEntry = agents.find((a) => a.agent.def.name === toName);

        if (!srcEntry || !tgtEntry) return;

        const src = positions[srcEntry.agent.id];
        const tgt = positions[tgtEntry.agent.id];

        if (!src || !tgt) return;

        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = "rgba(100,200,255,0.25)";
        ctx.lineWidth = 1.5;

        // Arrow
        const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);
        const arrowX = tgt.x - Math.cos(angle) * 18;
        const arrowY = tgt.y - Math.sin(angle) * 18;
        ctx.lineTo(arrowX, arrowY);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(
          arrowX - 8 * Math.cos(angle - 0.4),
          arrowY - 8 * Math.sin(angle - 0.4)
        );
        ctx.lineTo(
          arrowX - 8 * Math.cos(angle + 0.4),
          arrowY - 8 * Math.sin(angle + 0.4)
        );
        ctx.closePath();
        ctx.fillStyle = "rgba(100,200,255,0.5)";
        ctx.fill();
      });
    }

    // Draw nodes
    Object.values(positions).forEach(({ x, y, agent }) => {
      const color =
        agent.status === "running"
          ? "#4fffb0"
          : agent.status === "cooldown"
          ? "#ffb347"
          : "#4a9eff";

      // Glow
      ctx.shadowColor = color;
      ctx.shadowBlur = agent.status === "running" ? 15 : 5;

      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.shadowBlur = 0;

      // Label
      ctx.fillStyle = "#eee";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(agent.def.name.slice(0, 10), x, y + 24);
    });
  }

  // ─── Styles ──────────────────────────────────────────────────────────────

  _injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #__nrd-devtools__ {
        position: fixed;
        top: 0;
        right: 0;
        width: 360px;
        height: 100vh;
        background: #0d1117;
        color: #c9d1d9;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 11px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        border-left: 1px solid #30363d;
        transform: translateX(100%);
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
        box-shadow: -4px 0 24px rgba(0,0,0,0.6);
      }

      .nrd-dt-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #161b22;
        border-bottom: 1px solid #30363d;
        flex-shrink: 0;
      }

      .nrd-dt-logo {
        font-size: 12px;
        font-weight: bold;
        color: #4a9eff;
        flex: 1;
      }

      .nrd-dt-tabs {
        display: flex;
        gap: 2px;
      }

      .nrd-tab {
        background: transparent;
        border: 1px solid #30363d;
        color: #8b949e;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10px;
        font-family: inherit;
        transition: all 0.15s;
      }

      .nrd-tab.active, .nrd-tab:hover {
        background: #1f6feb;
        color: #fff;
        border-color: #1f6feb;
      }

      .nrd-dt-close {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 14px;
        padding: 2px 4px;
      }
      .nrd-dt-close:hover { color: #ff4444; }

      .nrd-dt-body {
        flex: 1;
        overflow: hidden;
        position: relative;
      }

      .nrd-tab-content {
        display: none;
        height: 100%;
        overflow-y: auto;
        padding: 8px;
        box-sizing: border-box;
      }
      .nrd-tab-content.active { display: block; }

      #nrd-graph-canvas {
        width: 100%;
        background: #0d1117;
        border-radius: 6px;
        display: block;
      }

      .nrd-graph-legend {
        display: flex;
        gap: 12px;
        padding: 6px 4px;
        color: #8b949e;
        font-size: 10px;
        align-items: center;
      }

      .nrd-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 2px;
      }
      .nrd-dot-idle { background: #4a9eff; }
      .nrd-dot-running { background: #4fffb0; }
      .nrd-dot-cooldown { background: #ffb347; }

      .nrd-agent-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px;
        border-bottom: 1px solid #21262d;
        transition: background 0.1s;
      }
      .nrd-agent-row:hover { background: #161b22; }

      .nrd-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-top: 3px;
        flex-shrink: 0;
      }
      .nrd-status-idle { background: #4a9eff; }
      .nrd-status-running { background: #4fffb0; box-shadow: 0 0 6px #4fffb0; }
      .nrd-status-cooldown { background: #ffb347; }
      .nrd-status-scheduled { background: #bf8fff; }

      .nrd-agent-info {
        flex: 1;
        min-width: 0;
      }

      .nrd-agent-info strong {
        display: block;
        color: #e6edf3;
        font-size: 12px;
      }

      .nrd-agent-id {
        color: #6e7681;
        font-size: 9px;
      }

      .nrd-traits {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-top: 3px;
      }

      .nrd-trait {
        background: #1f3a5f;
        color: #79c0ff;
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 9px;
      }

      .nrd-last-event {
        color: #8b949e;
        font-size: 9px;
        margin-top: 2px;
      }

      .nrd-state {
        color: #6e7681;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .nrd-emit-count {
        color: #4fffb0;
        font-size: 10px;
        flex-shrink: 0;
      }

      .nrd-event-row {
        display: grid;
        grid-template-columns: 60px 80px 1fr;
        gap: 4px;
        padding: 3px 4px;
        border-bottom: 1px solid #21262d;
        align-items: center;
        font-size: 10px;
        animation: nrd-fade-in 0.2s ease;
      }

      @keyframes nrd-fade-in {
        from { opacity: 0; transform: translateX(8px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .nrd-event-time { color: #6e7681; }
      .nrd-event-agent { color: #79c0ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .nrd-event-type { font-weight: bold; }
      .nrd-input { color: #ffa657; }
      .nrd-emit { color: #4fffb0; }
      .nrd-event-data { grid-column: 1 / -1; color: #6e7681; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .nrd-dt-footer {
        padding: 6px 12px;
        background: #161b22;
        border-top: 1px solid #30363d;
        color: #6e7681;
        font-size: 10px;
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }
}
