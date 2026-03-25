/**
 * NeuroDOM Compiler — Flow Compiler
 * Transforms NRD flow DSL code into executable pipeline definitions.
 *
 * DSL grammar examples:
 *   input.movie -> enrich -> state.movie
 *   input.movies -> filter(m => m.rating > 7) -> map(m => m.title) -> state.titles
 *   input.event -> match { click => ui.scale(1.2), hover => ui.highlight }
 *   [input.movie, input.user] -> merge -> ui.render
 *   on lifecycle.mount -> fetch -> emit.movies
 */

export function compileFlows(flowASTs) {
  return flowASTs.map((flow) => ({
    name: flow.name,
    pipelines: parseFlowCode(flow.code),
  }));
}

// ─── Flow code → pipelines ────────────────────────────────────────────────────

function parseFlowCode(code) {
  const pipelines = [];
  const lines = splitLogicalLines(code);

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("//")) continue;

    try {
      const pipeline = parseFlowLine(line.trim());
      if (pipeline) pipelines.push(pipeline);
    } catch (e) {
      console.warn(`[NRD Compiler] Could not parse flow line: "${line}"\n`, e.message);
    }
  }

  return pipelines;
}

// Split on newlines but treat multi-line match blocks as one unit
function splitLogicalLines(code) {
  const lines = [];
  let buffer = "";
  let depth = 0;

  for (const char of code) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (char === "\n" && depth === 0) {
      if (buffer.trim()) lines.push(buffer.trim());
      buffer = "";
    } else {
      buffer += char;
    }
  }
  if (buffer.trim()) lines.push(buffer.trim());
  return lines;
}

// ─── Single line parser ───────────────────────────────────────────────────────

function parseFlowLine(line) {
  // Handle multi-source: [input.a, input.b] -> ...
  if (line.startsWith("[")) {
    return parseMultiSourcePipeline(line);
  }

  // Split on ->
  const parts = splitPipeline(line);
  if (parts.length < 2) return null;

  const source = parts[0].trim();
  const steps = parts.slice(1).map((s) => parseStep(s.trim()));

  return { source, steps };
}

// ─── Multi-source ────────────────────────────────────────────────────────────

function parseMultiSourcePipeline(line) {
  const srcMatch = line.match(/^\[([^\]]+)\]\s*->(.*)/s);
  if (!srcMatch) return null;

  const sources = srcMatch[1].split(",").map((s) => s.trim());
  const rest = srcMatch[2].trim();
  const steps = splitPipeline(rest).map((s) => parseStep(s.trim()));

  return { sources, steps };
}

// ─── Split on -> (aware of parentheses and braces) ────────────────────────────

function splitPipeline(str) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const next = str[i + 1];

    if ((c === "(" || c === "{") ) depth++;
    if ((c === ")" || c === "}")) depth--;

    if (c === "-" && next === ">" && depth === 0) {
      parts.push(current.trim());
      current = "";
      i++; // skip >
    } else {
      current += c;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ─── Step parsers ─────────────────────────────────────────────────────────────

function parseStep(step) {
  if (!step) return { type: "noop" };

  // emit.portName
  if (step.startsWith("emit.")) {
    return { type: "emit", port: step.slice(5) };
  }

  // state.xxx
  if (step.startsWith("state.")) {
    return { type: "assign", target: step };
  }

  // ui.action(args) or ui.action
  if (step.startsWith("ui.")) {
    return parseUIStep(step);
  }

  // match { event => action, ... }
  if (step.startsWith("match")) {
    return parseMatchStep(step);
  }

  // filter(fn)
  if (step.startsWith("filter(")) {
    return { type: "filter", fn: extractArrowFn(step, "filter") };
  }

  // map(fn)
  if (step.startsWith("map(")) {
    return { type: "map", fn: extractArrowFn(step, "map") };
  }

  // if(condition)
  if (step.startsWith("if(")) {
    const cond = step.slice(3, -1).trim();
    // eslint-disable-next-line no-new-func
    return { type: "condition", fn: new Function("value", `return (${cond})`) };
  }

  // log or log(label)
  if (step === "log" || step.startsWith("log(")) {
    const label = step.startsWith("log(") ? step.slice(4, -1) : "";
    return { type: "log", label };
  }

  // fn(args) — custom function call
  if (step.includes("(")) {
    return parseFnStep(step);
  }

  // Plain identifier or hyphenated name → FunctionRegistry call
  // Matches: "fetch-data", "render-cards", "myFunction", "my-fn-name"
  if (/^[a-zA-Z_$][a-zA-Z0-9_$-]*$/.test(step)) {
    // If it contains a hyphen, it MUST be a function name (not a valid JS identifier)
    // If no hyphen, it could be a variable assign — but we prefer fn call since
    // assigning to a bare name without "state." or a dot is ambiguous; treat as fn.
    return { type: "fn", name: step, args: [] };
  }

  // Fallback: raw JS expression
  return {
    type: "raw",
    // eslint-disable-next-line no-new-func
    fn: new Function("ctx", `with(ctx){ ${step} }`),
  };
}

function parseUIStep(step) {
  // ui.setText(".title", value) or ui.scale(1.1) etc.
  const dotIdx = step.indexOf(".", 3); // skip "ui."
  const parenIdx = step.indexOf("(");

  let action, args;

  if (parenIdx !== -1) {
    action = step.slice(3, parenIdx);
    const rawArgs = step.slice(parenIdx + 1, step.lastIndexOf(")"));
    args = parseArgs(rawArgs);
  } else {
    action = step.slice(3);
    args = [];
  }

  return { type: "ui", action, args };
}

function parseMatchStep(step) {
  // match { click => ui.scale(1.2), hover => ui.highlight, default => ui.reset }
  const braceContent = step.match(/\{([\s\S]*)\}/)?.[1] || "";
  const cases = {};

  // Split by comma or newline at depth 0
  const entries = splitMatchCases(braceContent);

  entries.forEach((entry) => {
    const arrowIdx = entry.indexOf("=>");
    if (arrowIdx === -1) return;

    const key = entry.slice(0, arrowIdx).trim();
    const valueStr = entry.slice(arrowIdx + 2).trim();
    cases[key] = [parseStep(valueStr)];
  });

  return { type: "match", cases };
}

function splitMatchCases(str) {
  const cases = [];
  let current = "";
  let depth = 0;

  for (const char of str) {
    if (char === "(" || char === "{") depth++;
    if (char === ")" || char === "}") depth--;
    if ((char === "," || char === "\n") && depth === 0) {
      if (current.trim()) cases.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) cases.push(current.trim());
  return cases;
}

function parseFnStep(step) {
  const parenIdx = step.indexOf("(");
  const name = step.slice(0, parenIdx).trim();
  const rawArgs = step.slice(parenIdx + 1, step.lastIndexOf(")"));
  const args = parseArgs(rawArgs);

  return { type: "fn", name, args };
}

// ─── Argument helpers ─────────────────────────────────────────────────────────

function parseArgs(rawArgs) {
  if (!rawArgs.trim()) return [];

  // If it looks like an arrow function, keep as-is (will be eval'd)
  if (rawArgs.includes("=>")) {
    // eslint-disable-next-line no-new-func
    return [new Function("return " + rawArgs.trim())()];
  }

  // Split by comma at depth 0
  const args = [];
  let current = "";
  let depth = 0;

  for (const char of rawArgs) {
    if (char === "(" || char === "[" || char === "{") depth++;
    if (char === ")" || char === "]" || char === "}") depth--;
    if (char === "," && depth === 0) {
      args.push(parseArgValue(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) args.push(parseArgValue(current.trim()));
  return args;
}

function parseArgValue(str) {
  if (str === "self") return "__self__"; // special token resolved at runtime
  if (str === "true") return true;
  if (str === "false") return false;
  if (str === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str; // variable name or expression
}

function extractArrowFn(step, fnName) {
  const inner = step.slice(fnName.length + 1, -1).trim();
  // eslint-disable-next-line no-new-func
  return new Function("return " + inner)();
}

// ─── Graph compiler ──────────────────────────────────────────────────────────

export function compileGraph(graphCode) {
  if (!graphCode) return [];

  const connections = [];

  graphCode.split("\n").forEach((line) => {
    line = line.trim();
    if (!line || line.startsWith("//")) return;

    const parts = line.split("->").map((p) => p.trim());
    if (parts.length !== 2) return;

    connections.push({ from: parts[0], to: parts[1] });
  });

  return connections;
}

// ─── State compiler ──────────────────────────────────────────────────────────

export function compileState(stateCode) {
  if (!stateCode) return () => ({});
  // eslint-disable-next-line no-new-func
  return new Function(`
    const __state = {};
    ${stateCode.replace(/\blet\s+(\w+)\s*=\s*([^;\n]+)/g, "__state.$1 = $2;")}
    return __state;
  `);
}
