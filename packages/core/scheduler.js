/**
 * NeuroDOM Core — Scheduler
 * Orchestrates agent execution with priority, cooldown, and batch optimization.
 */

export class Scheduler {
  constructor() {
    this.queue = []; // { agent, event, score }
    this.running = false;
    this._executed = new Set();
    this._frameId = null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._frameId) cancelAnimationFrame(this._frameId);
  }

  schedule(agent, event) {
    // Skip if agent is in cooldown
    if (agent.status === "cooldown") return;

    // Skip duplicate events in same frame
    const key = `${agent.id}:${event.type}`;
    if (this._executed.has(key)) return;

    this.queue.push({ agent, event, score: 0 });
  }

  // ─── Internal Loop ──────────────────────────────────────────────────────

  _loop() {
    if (!this.running) return;

    this._executed.clear();
    this._processBatch();

    this._frameId = requestAnimationFrame(() => this._loop());
  }

  _processBatch(limit = 10) {
    if (this.queue.length === 0) return;

    // Score all entries
    this.queue.forEach((entry) => {
      entry.score = this._computePriority(entry.agent, entry.event);
    });

    // Sort by score descending
    this.queue.sort((a, b) => b.score - a.score);

    // Process up to `limit` agents
    const toRun = this.queue.splice(0, limit);

    toRun.forEach(({ agent, event }) => {
      const key = `${agent.id}:${event.type}`;
      this._executed.add(key);
      this._execute(agent, event);
    });
  }

  _execute(agent, event) {
    if (agent.status === "cooldown" || agent.status === "running") return;

    agent.run(event);
    agent.status = "cooldown";

    const cooldownMs = this._cooldownFor(event);

    setTimeout(() => {
      agent.status = "idle";
      agent.energy = Math.max(0, agent.energy - 1);
    }, cooldownMs);
  }

  // ─── Priority ────────────────────────────────────────────────────────────

  _computePriority(agent, event) {
    let score = 0;

    // UI events are high priority
    if (event.type.startsWith("ui.")) score += 8;

    // Lifecycle events are highest
    if (event.type.startsWith("lifecycle.")) score += 15;

    // Input data events
    if (event.type.startsWith("input.")) score += 5;

    // Energy (recently active agents get boost)
    score += agent.energy * 2;

    // Starvation prevention (older entries get bumped)
    const age = (Date.now() - agent.lastRun) / 1000;
    score += Math.min(age * 0.5, 5);

    // Active window boost
    if (Date.now() < agent.activeUntil) score += 10;

    return score;
  }

  _cooldownFor(event) {
    if (event.type.startsWith("lifecycle.")) return 0;
    if (event.type.startsWith("interval.")) return 16;
    if (event.type.startsWith("ui.")) return 16;
    return 32;
  }

  // ─── Stats (DevTools) ────────────────────────────────────────────────────

  getStats() {
    return {
      queueLength: this.queue.length,
      running: this.running,
    };
  }
}
