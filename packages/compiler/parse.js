/**
 * NeuroDOM Compiler — NRD Parser
 * Parses .nrd files into an intermediate AST object.
 */

/**
 * parseNRD(content: string) → AgentAST
 */
export function parseNRD(content) {
  // Use browser DOMParser or lightweight parse for Node.js
  let doc;
  let agentEl;

  if (typeof DOMParser !== "undefined") {
    // D'abord, vérifier si le contenu est déjà un document HTML valide
    // Si c'est le cas, on extrait directement l'agent
    try {
      // Essayer de parser comme un document complet
      const tempDoc = new DOMParser().parseFromString(content, "text/html");
      agentEl = tempDoc.querySelector("agent");
      
      if (agentEl) {
        // Si on trouve un agent, utiliser ce document
        doc = tempDoc;
      } else {
        // Sinon, essayer de parser comme un fragment XML
        // Envelopper dans un élément root pour éviter les problèmes de parsing
        const wrappedContent = `<root>${content}</root>`;
        const wrappedDoc = new DOMParser().parseFromString(wrappedContent, "text/xml");
        agentEl = wrappedDoc.querySelector("agent");
        
        if (agentEl) {
          doc = wrappedDoc;
        } else {
          // Dernier recours: chercher dans le document original
          agentEl = tempDoc.querySelector("agent");
          if (agentEl) {
            doc = tempDoc;
          }
        }
      }
    } catch (e) {
      console.error("Failed to parse NRD:", e);
      // Fallback: parser comme XML
      const wrappedDoc = new DOMParser().parseFromString(`<root>${content}</root>`, "text/xml");
      agentEl = wrappedDoc.querySelector("agent");
      doc = wrappedDoc;
    }
    
    if (!agentEl) {
      console.error("[NRD] Content received:", content.substring(0, 500));
      throw new Error("[NRD] No <agent> tag found");
    }
  } else {
    // Node.js fallback via regex-based extraction
    return parseNRDNode(content);
  }

  return extractAST(agentEl, content);
}

function extractAST(agentEl, raw) {
  // ── Name ──────────────────────────────────────────────────────────────
  const name = agentEl.getAttribute("name");
  if (!name) throw new Error("[NRD] <agent> must have a name attribute");

  // ── Identity ──────────────────────────────────────────────────────────
  const identityEl = agentEl.querySelector("identity");
  const identity = {
    traits: identityEl
      ? [...identityEl.querySelectorAll("trait")].map((t) =>
          t.textContent.trim()
        )
      : [],
    family: identityEl?.querySelector("family")?.textContent.trim() || null,
    visibility:
      identityEl?.querySelector("visibility")?.textContent.trim() || "public",
  };

  // ── Ports ─────────────────────────────────────────────────────────────
  const portsEl = agentEl.querySelector("ports");
  const ports = { in: [], out: [] };

  if (portsEl) {
    portsEl.querySelectorAll("in").forEach((el) => {
      ports.in.push({
        name: el.getAttribute("name"),
        type: el.getAttribute("type") || null,
      });
    });
    portsEl.querySelectorAll("out").forEach((el) => {
      ports.out.push({
        name: el.getAttribute("name"),
        type: el.getAttribute("type") || null,
      });
    });
  }

  // ── Template ──────────────────────────────────────────────────────────
  const viewEl = agentEl.querySelector("view") || agentEl.querySelector("template");
  const template = viewEl ? viewEl.innerHTML.trim() : "";

  // ── State ─────────────────────────────────────────────────────────────
  const stateEl = agentEl.querySelector("state");
  const stateCode = stateEl ? stateEl.textContent.trim() : "";

  // ── Flows ─────────────────────────────────────────────────────────────
  const flowEls = agentEl.querySelectorAll("flow");
  const flows = [];

  if (flowEls.length > 0) {
    flowEls.forEach((el) => {
      flows.push({
        name: el.getAttribute("name") || "default",
        code: el.textContent.trim(),
      });
    });
  } else {
    // Backward compat: single <behavior> block
    const behaviorEl = agentEl.querySelector("behavior");
    if (behaviorEl) {
      flows.push({
        name: "default",
        code: behaviorEl.textContent.trim(),
      });
    }
  }

  // ── Graph ─────────────────────────────────────────────────────────────
  const graphEl = agentEl.querySelector("graph");
  const graphCode = graphEl ? graphEl.textContent.trim() : "";

  // ── Soul (LLM) ────────────────────────────────────────────────────────
  const soulEl = agentEl.querySelector("soul");
  const soul = soulEl
    ? {
        model: soulEl.getAttribute("model") || "default",
        personality: soulEl.getAttribute("personality") || null,
      }
    : null;

  // ── Components ────────────────────────────────────────────────────────
  // Sub-agents defined inline (future)
  const components = [];

  return {
    name,
    identity,
    ports,
    template,
    stateCode,
    flows,
    graphCode,
    soul,
    components,
  };
}

// ─── Node.js fallback parser ─────────────────────────────────────────────────

function parseNRDNode(content) {
  // ── Helpers ──────────────────────────────────────────────────────────────

  // Extract content of the FIRST matching tag (non-greedy, handles nesting)
  const extractFirst = (tag) => {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = content.match(re);
    return m ? m[1].trim() : "";
  };

  // Extract attribute value from first matching opening tag
  const extractAttr = (tag, attr) => {
    const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i");
    const m = content.match(re);
    return m ? m[1] : null;
  };

  // Extract ALL occurrences of a tag with their attributes and content
  const extractAll = (tag) => {
    const re = new RegExp(`<${tag}((?:\\s[^>]*)?)>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const results = [];
    let m;
    while ((m = re.exec(content)) !== null) {
      const attrs = {};
      const attrStr = m[1];
      const attrRe = /\s(\w+)="([^"]*)"/g;
      let am;
      while ((am = attrRe.exec(attrStr)) !== null) attrs[am[1]] = am[2];
      results.push({ attrs, content: m[2].trim() });
    }
    return results;
  };

  // Extract all self-closing tags matching a pattern
  const extractSelfClosing = (tag) => {
    const re = new RegExp(`<${tag}((?:\\s[^>]*)?)\\s*/?>`, "gi");
    const results = [];
    let m;
    while ((m = re.exec(content)) !== null) {
      const attrs = {};
      const attrRe = /\s(\w+)="([^"]*)"/g;
      let am;
      while ((am = attrRe.exec(m[1])) !== null) attrs[am[1]] = am[2];
      results.push(attrs);
    }
    return results;
  };

  // ── Name ─────────────────────────────────────────────────────────────────
  const name = extractAttr("agent", "name") || "UnknownAgent";

  // ── Identity ─────────────────────────────────────────────────────────────
  const identityContent = extractFirst("identity");
  const traits = [...identityContent.matchAll(/<trait[^>]*>([^<]+)<\/trait>/gi)]
    .map(m => m[1].trim());
  const familyM = identityContent.match(/<family[^>]*>([^<]+)<\/family>/i);
  const visibilityM = identityContent.match(/<visibility[^>]*>([^<]+)<\/visibility>/i);
  const identity = {
    traits,
    family: familyM ? familyM[1].trim() : null,
    visibility: visibilityM ? visibilityM[1].trim() : "public",
  };

  // ── Ports ─────────────────────────────────────────────────────────────────
  const portsContent = extractFirst("ports");
  const ports = { in: [], out: [] };

  // Self-closing <in name="..." type="..." /> and <in name="..."></in>
  [...portsContent.matchAll(/<in\s+name="([^"]+)"(?:\s+type="([^"]*)")?[^>]*\/?>/gi)]
    .forEach(([, n, t]) => ports.in.push({ name: n, type: t || null }));
  [...portsContent.matchAll(/<out\s+name="([^"]+)"(?:\s+type="([^"]*)")?[^>]*\/?>/gi)]
    .forEach(([, n, t]) => ports.out.push({ name: n, type: t || null }));

  // ── Template / View ───────────────────────────────────────────────────────
  const template = extractFirst("view") || extractFirst("template");

  // ── State ─────────────────────────────────────────────────────────────────
  const stateCode = extractFirst("state");

  // ── Flows — extract ALL <flow> blocks with their name attribute ───────────
  const flowBlocks = extractAll("flow");
  const flows = flowBlocks.length > 0
    ? flowBlocks.map(f => ({
        name: f.attrs.name || "default",
        code: f.content,
      }))
    : [{ name: "default", code: extractFirst("behavior") }];

  // ── Graph ─────────────────────────────────────────────────────────────────
  const graphCode = extractFirst("graph");

  // ── Soul ─────────────────────────────────────────────────────────────────
  const soulM = content.match(/<soul\s+model="([^"]*)"(?:\s+personality="([^"]*)")?/i);
  const soul = soulM ? { model: soulM[1], personality: soulM[2] || null } : null;

  return {
    name,
    identity,
    ports,
    template,
    stateCode,
    flows,
    graphCode,
    soul,
    components: [],
  };
}