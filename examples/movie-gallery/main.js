/**
 * NeuroDOM Movie Gallery — main.js
 */

import { createApp }       from "../../packages/core/index.js";
import { FunctionRegistry } from "../../packages/core/agent.js";
import { NeuroDevTools }   from "../../packages/devtools/index.js";

import MovieFetcherDef  from "/examples/movie-gallery/MovieFetcher.nrd";
import MovieGridDef     from "/examples/movie-gallery/MovieGrid.nrd";
import MovieCardDef     from "/examples/movie-gallery/MovieCard.nrd";
import PreviewPlayerDef from "/examples/movie-gallery/PreviewPlayer.nrd";

// ── Données ──────────────────────────────────────────────────────────────────

const MOVIES = [
  { id:1, title:"Dune: Part Two",          year:2024, rating:8.4, genre:"Science-Fiction",
    overview:"Paul Atréides s'unit aux Fremen pour mener la guerre sainte contre ses ennemis.",
    poster:"https://images.unsplash.com/photo-1509266272358-7701da638078?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1509266272358-7701da638078?w=800&q=80" },
  { id:2, title:"Inception",               year:2010, rating:8.8, genre:"Sci-Fi",
    overview:"Un voleur infiltrant les rêves doit implanter une idée dans l'esprit d'un PDG.",
    poster:"https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&q=80" },
  { id:3, title:"Interstellar",            year:2014, rating:8.6, genre:"Sci-Fi",
    overview:"Des astronautes traversent un ver de l'espace pour assurer la survie de l'humanité.",
    poster:"https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800&q=80" },
  { id:4, title:"The Matrix",              year:1999, rating:8.7, genre:"Action",
    overview:"Un programmeur découvre que la réalité est une simulation et rejoint la résistance.",
    poster:"https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80" },
  { id:5, title:"Blade Runner 2049",       year:2017, rating:8.0, genre:"Neo-Noir",
    overview:"Un jeune blade runner découvre un secret qui pourrait plonger la société dans le chaos.",
    poster:"https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=800&q=80" },
  { id:6, title:"Oppenheimer",             year:2023, rating:8.5, genre:"Drame",
    overview:"L'histoire du physicien J. Robert Oppenheimer et son rôle dans la création de la bombe atomique.",
    poster:"https://images.unsplash.com/photo-1463171379579-3fdfb86d6285?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1569230919100-d3fd5e1132f4?w=800&q=80" },
  { id:7, title:"2001: A Space Odyssey",   year:1968, rating:8.3, genre:"Sci-Fi",
    overview:"Des astronautes voyagent vers Jupiter pour trouver l'origine d'un artefact extraterrestre.",
    poster:"https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=80" },
  { id:8, title:"Parasite",                year:2019, rating:8.5, genre:"Thriller",
    overview:"La cupidité et la discrimination de classe menacent deux familles coréennes.",
    poster:"https://images.unsplash.com/photo-1574267432553-4b4628081c31?w=300&q=80",
    backdrop:"https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80" },
];

// ── FunctionRegistry ─────────────────────────────────────────────────────────
// Chaque fonction est nommée pour correspondre au step utilisé dans le .nrd
// Syntaxe NRD : lifecycle.mount -> fetch-data -> emit.movies
// => "fetch-data" est résolu ici

FunctionRegistry.register("fetch-data", (ctx) => {
  ctx.state.loaded = true;
  return MOVIES; // devient ctx.current → transmis à emit.movies
});

FunctionRegistry.register("render-cards", (ctx) => {
  const movies = ctx.current;
  if (!Array.isArray(movies) || !movies.length) return;

  ctx.state.movies = movies;
  const kernel = window.__NEURODOM_KERNEL__;
  const gridEl = ctx.self.el.querySelector(".movie-grid");
  if (!gridEl) return;

  gridEl.innerHTML = "";

  movies.forEach((movie) => {
    const cardEl = document.createElement("movie-card");
    gridEl.appendChild(cardEl);
    const cardAgent = kernel.instantiate(MovieCardDef, cardEl);
    // Remonter les hover de la carte vers MovieGrid
    cardAgent.on("hover", (data) => ctx.emit("hover", data));
    // Injecter le film
    cardAgent.receive("movie", movie);
  });
});

FunctionRegistry.register("populate-card", (ctx) => {
  const m = ctx.current;
  if (!m) return;
  ctx.state.movie = m;
  ctx.ui.setAttr(".card-poster", "src",  m.poster);
  ctx.ui.setAttr(".card-poster", "alt",  m.title);
  ctx.ui.setText(".card-title",          m.title);
  ctx.ui.setText(".card-rating",  `★ ${m.rating}`);
  ctx.ui.setText(".card-year",    String(m.year));
});

FunctionRegistry.register("card-hover", (ctx) => {
  if (!ctx.state.movie) return;
  ctx.ui.addClass(".card", "selected");
  ctx.emit("hover", ctx.state.movie);
});

FunctionRegistry.register("card-leave", (ctx) => {
  ctx.ui.removeClass(".card", "selected");
});

FunctionRegistry.register("show-preview", (ctx) => {
  const m = ctx.current;
  if (!m) return;
  ctx.state.current = m;

  const empty = ctx.self.el.querySelector("#preview-empty");
  const card  = ctx.self.el.querySelector("#preview-card");

  if (empty) empty.style.display = "none";
  if (card) {
    card.style.display = "block";
    card.classList.remove("visible");
    void card.offsetHeight;
    card.classList.add("visible");
  }

  ctx.ui.setAttr(".preview-backdrop",     "src", m.backdrop || m.poster);
  ctx.ui.setAttr(".preview-backdrop",     "alt", m.title);
  ctx.ui.setText(".preview-title",               m.title);
  ctx.ui.setText(".preview-rating-badge", `★ ${m.rating}`);
  ctx.ui.setText(".preview-year",         String(m.year));
  ctx.ui.setText(".preview-genre",               m.genre);
  ctx.ui.setText(".preview-overview",            m.overview);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("[NeuroDOM] Démarrage...");

  new NeuroDevTools().install();

  const app    = createApp(MovieGridDef);
  const kernel = app.kernel;

  window.__NEURODOM_DEFS__ = {
    "movie-fetcher":  MovieFetcherDef,
    "movie-grid":     MovieGridDef,
    "movie-card":     MovieCardDef,
    "preview-player": PreviewPlayerDef,
  };

  // Ordre : grid + preview d'abord, fetcher en dernier
  // (les connexions doivent exister avant que le fetcher émette)
  for (const tag of ["movie-grid", "preview-player", "movie-fetcher"]) {
    const el  = document.querySelector(tag);
    const def = window.__NEURODOM_DEFS__[tag];
    if (!el || !def) { console.warn(`[NRD] <${tag}> introuvable`); continue; }
    if (!el.__nrd_agent) {
      el.__nrd_agent = kernel.instantiate(def, el);
      console.log(`✓ <${tag}> instancié`);
    }
  }

  // Câblage du graphe global
  kernel.connect("MovieFetcher.movies", "MovieGrid.movies");
  kernel.connect("MovieGrid.hover",     "PreviewPlayer.movie");
  console.log("[NeuroDOM] Graphe : MovieFetcher→MovieGrid→PreviewPlayer");

  kernel.start();
  console.log("[NeuroDOM] Runtime actif — Ctrl+Shift+D pour DevTools");
}

main().catch(console.error);
