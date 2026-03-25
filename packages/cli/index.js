#!/usr/bin/env node
/**
 * NeuroDOM CLI — Dev Server + Build
 * Usage:
 *   neurodom dev       → start dev server with HMR
 *   neurodom build     → compile all .nrd → .js
 *   neurodom create    → scaffold new project
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const cmd = process.argv[2] || "dev";
const PORT = parseInt(process.argv[3]) || 3000;

// ─── Resolve package paths ───────────────────────────────────────────────────

const CORE_PATH = path.resolve(__dirname, "../core");
const COMPILER_PATH = path.resolve(__dirname, "../compiler");
const DEVTOOLS_PATH = path.resolve(__dirname, "../devtools");

// ─── MIME types ──────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".nrd": "application/javascript", // compiled on the fly
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// ─── Commands ────────────────────────────────────────────────────────────────

if (cmd === "dev") {
  startDevServer();
} else if (cmd === "build") {
  buildProject();
} else if (cmd === "create") {
  scaffoldProject(process.argv[3]);
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

// ─── Dev Server ──────────────────────────────────────────────────────────────

async function startDevServer() {
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    let urlPath = req.url.split("?")[0];

    // Default to index.html
    if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

    // Special route: neurodom runtime bundle
    if (urlPath === "/__neurodom__/runtime.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(buildRuntimeBundle());
      return;
    }

    // HMR client
    if (urlPath === "/__neurodom__/hmr-client.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(HMR_CLIENT);
      return;
    }

    // Resolve file
    let filePath;

    // Check neurodom package paths
    if (urlPath.startsWith("/neurodom/")) {
      const rel = urlPath.slice("/neurodom/".length);
      filePath = path.resolve(__dirname, "../../..", rel);
    } else {
      filePath = path.join(cwd, urlPath);
    }

    const ext = path.extname(filePath);

    // Compile .nrd files on the fly
    if (ext === ".nrd") {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const compiled = await compileNRDFile(content);
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(compiled);
      } catch (e) {
        res.writeHead(500);
        res.end(`// Compilation error: ${e.message}`);
      }
      return;
    }

    // Inject HMR script into HTML
    if (ext === ".html") {
      try {
        let html = fs.readFileSync(filePath, "utf-8");
        html = injectHMR(html);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // Static file
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  // WebSocket for HMR
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  // File watcher
  watchFiles(cwd, (changedFile) => {
    console.log(`[HMR] Changed: ${path.relative(cwd, changedFile)}`);
    clients.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "reload", file: changedFile }));
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║  ⬡  NeuroDOM Dev Server                  ║
║                                           ║
║  Local:  http://localhost:${PORT}           ║
║  DevTools: Ctrl+Shift+D                   ║
╚═══════════════════════════════════════════╝
    `);
  });
}

// ─── Runtime bundle builder ──────────────────────────────────────────────────

function buildRuntimeBundle() {
  const files = [
    path.join(CORE_PATH, "agent.js"),
    path.join(CORE_PATH, "scheduler.js"),
    path.join(CORE_PATH, "registry.js"),
    path.join(CORE_PATH, "ui.js"),
    path.join(CORE_PATH, "kernel.js"),
    path.join(CORE_PATH, "index.js"),
    path.join(COMPILER_PATH, "parse.js"),
    path.join(COMPILER_PATH, "flow.js"),
    path.join(COMPILER_PATH, "index.js"),
    path.join(DEVTOOLS_PATH, "index.js"),
  ];

  let bundle = `// NeuroDOM Runtime Bundle — ${new Date().toISOString()}\n\n`;

  files.forEach((f) => {
    try {
      let code = fs.readFileSync(f, "utf-8");
      // Strip import/export for simple bundling
      code = code.replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, "");
      code = code.replace(/^export\s+\{[^}]+\}\s*;?\s*$/gm, "");
      code = code.replace(/^export\s+(default\s+)?/gm, "");
      bundle += `// ── ${path.basename(f)} ──\n${code}\n\n`;
    } catch (e) {
      bundle += `// Could not include ${f}: ${e.message}\n`;
    }
  });

  return bundle;
}

// ─── NRD Compiler (async, Node-side) ────────────────────────────────────────

async function compileNRDFile(content) {
  // Lazy import compiler
  const { compileNRD } = await import(
    path.join(COMPILER_PATH, "index.js")
  );

  const def = compileNRD(content);

  // Serialize to ES module
  return `
// Auto-compiled .nrd — NeuroDOM Compiler
export default {
  name: ${JSON.stringify(def.name)},
  identity: ${JSON.stringify(def.identity)},
  inputs: ${JSON.stringify(def.inputs)},
  outputs: ${JSON.stringify(def.outputs)},
  template: ${JSON.stringify(def.template)},
  state: ${serializeStateFn(def.state)},
  flows: ${JSON.stringify(def.flows, serializeFlows)},
  graph: ${JSON.stringify(def.graph)},
  soul: ${JSON.stringify(def.soul)},
};
`.trim();
}

function serializeStateFn(fn) {
  if (!fn || typeof fn !== "function") return "() => ({})";
  return fn.toString();
}

function serializeFlows(key, value) {
  if (typeof value === "function") return `__FN__${value.toString()}__FN__`;
  return value;
}

// ─── HMR ─────────────────────────────────────────────────────────────────────

function injectHMR(html) {
  const scripts = `
  <script src="/__neurodom__/runtime.js"></script>
  <script src="/__neurodom__/hmr-client.js"></script>
  `;
  return html.replace("</head>", `${scripts}</head>`);
}

const HMR_CLIENT = `
(function() {
  const ws = new WebSocket('ws://localhost:${PORT}');
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'reload') {
      console.log('[HMR] Reloading...');
      location.reload();
    }
  };
  ws.onopen = () => console.log('[NeuroDOM HMR] Connected');
})();
`;

// ─── File watcher ─────────────────────────────────────────────────────────────

function watchFiles(dir, onChange) {
  const ignored = new Set(["node_modules", ".git", "dist"]);

  function watch(d) {
    fs.watch(d, { persistent: false }, (event, filename) => {
      if (filename) onChange(path.join(d, filename));
    });

    fs.readdirSync(d).forEach((entry) => {
      if (ignored.has(entry)) return;
      const full = path.join(d, entry);
      if (fs.statSync(full).isDirectory()) {
        try { watch(full); } catch {}
      }
    });
  }

  try { watch(dir); } catch {}
}

// ─── Build ───────────────────────────────────────────────────────────────────

async function buildProject() {
  const outDir = path.join(cwd, "dist");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("[Build] Starting NeuroDOM build...");

  // Find all .nrd files
  const nrdFiles = findFiles(cwd, ".nrd");

  for (const file of nrdFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const compiled = await compileNRDFile(content);
    const rel = path.relative(cwd, file);
    const outPath = path.join(outDir, rel.replace(".nrd", ".js"));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, compiled);
    console.log(`  ✓ ${rel}`);
  }

  // Copy HTML/CSS/JS
  const staticFiles = findFiles(cwd, ".html", ".css", ".js");
  staticFiles.forEach((file) => {
    if (file.includes("node_modules") || file.includes("dist")) return;
    const rel = path.relative(cwd, file);
    const outPath = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(file, outPath);
  });

  console.log(`[Build] Done → ${outDir}`);
}

function findFiles(dir, ...exts) {
  const results = [];
  const ignored = new Set(["node_modules", ".git", "dist"]);

  function walk(d) {
    fs.readdirSync(d).forEach((entry) => {
      if (ignored.has(entry)) return;
      const full = path.join(d, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (exts.some((e) => full.endsWith(e))) results.push(full);
    });
  }

  walk(dir);
  return results;
}

// ─── Scaffold ────────────────────────────────────────────────────────────────

function scaffoldProject(name = "my-neurodom-app") {
  const dir = path.join(cwd, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "src/agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src/pages"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${name}</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>`
  );

  fs.writeFileSync(
    path.join(dir, "src/main.js"),
    `import { createApp } from "neurodom";
import { NeuroDevTools } from "neurodom/devtools";
import App from "./pages/App.nrd";

// Install DevTools (Ctrl+Shift+D to toggle)
new NeuroDevTools().install();

createApp(App).mount("#app");`
  );

  fs.writeFileSync(
    path.join(dir, "src/pages/App.nrd"),
    `<agent name="App">

  <view>
    <div class="app">
      <h1>Hello NeuroDOM 👋</h1>
      <my-counter></my-counter>
    </div>
  </view>

  <graph>
    my-counter.count -> my-counter.display
  </graph>

</agent>`
  );

  fs.writeFileSync(
    path.join(dir, "src/agents/MyCounter.nrd"),
    `<agent name="MyCounter">

  <view>
    <div class="counter">
      <span class="value">0</span>
      <button>+1</button>
    </div>
  </view>

  <ports>
    <out name="count" />
    <in name="display" />
  </ports>

  <state>
    let count = 0
  </state>

  <flow>
    lifecycle.mount -> raw
    ui.click -> raw
  </flow>

</agent>`
  );

  console.log(`✅ Project created: ${name}/`);
  console.log(`   cd ${name} && neurodom dev`);
}
