// ---------------------------------------------------------------------------
// Génère `src/styles/appleLight.ts` : le style MapLibre du mode clair.
//
// Même méthode que `build-apple-dark-style.mjs` : on part du style OpenFreeMap
// « Liberty » (mêmes tuiles, même sprite, mêmes polices — le hors-ligne n'y
// voit aucune différence) et on le retouche façon « Apple Plans » clair.
//
// Demandé le 29 septembre 2026, capture d'Apple Plans sur l'Île-de-France à
// l'appui. Ce qui les séparait, et ce que ce style corrige :
//
// - **le jaune des routes écrasait tout** : les routes deviennent grises aux
//   zooms larges et blanches cernées de gris de près ; seules les autoroutes
//   gardent une teinte (gris-lilas) ;
// - **la banlieue formait une tache grise** : les zones bâties sont à peine
//   plus sombres que le fond, crème ;
// - **forêts, parcs et eau se perdaient** : verts et bleus plus francs, cours
//   d'eau plus épais ;
// - **tous les noms de lieux se valaient** : les villes passent en gras et plus
//   gros, les villages s'affichent plus tard et plus petits, les lieux-dits
//   encore plus tard ;
// - **les numéros de route étaient des cartouches blancs** : ils prennent les
//   couleurs de la signalisation française (A et N rouges, D jaunes, E verts…),
//   les mêmes que le bandeau de la navigation voiture (`roadClass`). Les images
//   des cartouches sont dessinées par l'application (`map/roadShields.ts`) :
//   le sprite de Liberty n'en a qu'un, blanc, et on ne peut pas le recolorer.
//
// Les largeurs de traits, filtres et paliers de zoom de Liberty sont gardés,
// sauf là où ce commentaire dit le contraire.
//
// Usage : `npm run build:light-style`
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIBERTY_URL = "https://tiles.openfreemap.org/styles/liberty";
const OUT = path.join(fileURLToPath(new URL("../src/styles/appleLight.ts", import.meta.url)));

// --- Palette « Apple Plans » clair -----------------------------------------
const C = {
  land: "#f7f5ef",
  residential: "#eeebe4",
  water: "#9fcdf6",
  waterway: "#8dc2f2",
  wood: "#c6e2ae",
  grass: "#d3e9c1",
  park: "#c9e5b3",
  parkOutline: "#b3d69a",
  wetland: "#d6e9d3",
  sand: "#f3ecd2",
  ice: "#eef3f5",
  cemetery: "#dbe6cf",
  pitch: "#d6eac8",
  hospital: "#f7e3e6",
  school: "#f1eedd",
  building: "#e7e3db",
  buildingOut: "#dad5cb",
  building3d: "#e4e0d7",
  aeroway: "#dde7f3",
  runway: "#c9d7e8",

  // Routes : grises au loin, blanches de près (voir `zoomed`).
  motorwayFar: "#b9b0cc",
  motorwayNear: "#e6e1f0",
  motorwayCasing: "#a79dbd",
  primaryFar: "#d8d4cc",
  secondaryFar: "#dfdbd4",
  roadNear: "#ffffff",
  casingMajor: "#cdc8bd",
  casingMinor: "#e0dcd3",
  path: "#ffffff",
  rail: "#c7c3bd",

  boundaryRegion: "#dba9c9",
  boundaryCountry: "#b58aac",

  textCapital: "#1c1c1e",
  textCity: "#1c1c1e",
  textTown: "#2c2c2e",
  textVillage: "#58585e",
  textOther: "#6d6d73",
  textRoad: "#5a5a60",
  textWater: "#2f6fb5",
  textAirport: "#3b73c7",
  poiText: "#6a6a70",
  halo: "rgba(255,255,255,0.92)",
};

/** Les couleurs des cartouches, celles du bandeau de navigation voiture. */
const SHIELD = {
  red: { text: "#ffffff" },
  yellow: { text: "#1c1c1e" },
  green: { text: "#ffffff" },
  cyan: { text: "#ffffff" },
  white: { text: "#1c1c1e" },
};

const has = (id, ...subs) => subs.some((s) => id.includes(s));
/** Une couleur qui passe de `far` (zooms larges) à `near` (de près). */
const zoomed = (far, near, from = 10, to = 13) => ["interpolate", ["linear"], ["zoom"], from, far, to, near];

function lineColor(id) {
  if (has(id, "rail")) return C.rail;
  if (has(id, "path", "pedestrian")) return C.path;
  if (has(id, "motorway")) return has(id, "casing") ? C.motorwayCasing : zoomed(C.motorwayFar, C.motorwayNear, 9, 13);
  if (has(id, "trunk", "primary")) return has(id, "casing") ? C.casingMajor : zoomed(C.primaryFar, C.roadNear);
  if (has(id, "secondary", "tertiary")) return has(id, "casing") ? C.casingMajor : zoomed(C.secondaryFar, C.roadNear, 11, 13);
  if (has(id, "link")) return has(id, "casing") ? C.casingMajor : C.roadNear;
  return has(id, "casing") ? C.casingMinor : C.roadNear;
}

function fillColor(id) {
  if (id === "background") return C.land;
  if (has(id, "residential")) return C.residential;
  if (has(id, "wood")) return C.wood;
  if (has(id, "grass")) return C.grass;
  if (id.startsWith("park")) return C.park;
  if (has(id, "wetland")) return C.wetland;
  if (has(id, "sand")) return C.sand;
  if (has(id, "ice")) return C.ice;
  if (has(id, "cemetery")) return C.cemetery;
  if (has(id, "pitch", "track")) return C.pitch;
  if (has(id, "hospital")) return C.hospital;
  if (has(id, "school")) return C.school;
  if (has(id, "building")) return C.building;
  if (has(id, "aeroway")) return C.aeroway;
  if (has(id, "water")) return C.water;
  return C.land;
}

const base = await fetch(LIBERTY_URL).then((r) => {
  if (!r.ok) throw new Error(`Téléchargement du style Liberty échoué (${r.status})`);
  return r.json();
});

/** La lettre initiale du numéro, ramenée à une couleur de cartouche. */
const shieldColor = [
  "match",
  ["upcase", ["slice", ["to-string", ["get", "ref"]], 0, 1]],
  ["A", "N"],
  "red",
  ["D"],
  "yellow",
  ["E", "F"],
  "green",
  ["M"],
  "cyan",
  "white",
];

const layers = [];
for (const layer of base.layers) {
  // L'ombrage Natural Earth des petits zooms : du gris sur un fond crème.
  if (layer.id === "natural_earth") continue;
  const l = structuredClone(layer);
  const p = l.paint || (l.paint = {});
  const lay = l.layout || (l.layout = {});

  if (l.type === "background") {
    p["background-color"] = C.land;
  } else if (l.type === "fill") {
    if ("fill-pattern" in p) {
      // Les motifs du sprite (zones piétonnes, marais) : un aplat discret.
      delete p["fill-pattern"];
      p["fill-color"] = has(l.id, "wetland") ? C.wetland : C.residential;
      p["fill-opacity"] = 0.6;
    } else {
      p["fill-color"] = fillColor(l.id);
    }
    // La banlieue ne doit plus faire tache : un voile à peine plus sombre que
    // le fond, qui s'efface en approchant (les bâtiments prennent le relais).
    if (l.id === "landuse_residential") {
      p["fill-color"] = C.residential;
      p["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 9, 0.9, 12, 0.4];
    }
    // Forêts et parcs : francs, pour structurer la carte comme chez Apple.
    if (has(l.id, "wood")) p["fill-opacity"] = ["interpolate", ["linear"], ["zoom"], 8, 0.85, 14, 0.7];
    if (has(l.id, "grass") || l.id === "park") p["fill-opacity"] = 0.85;
    if ("fill-outline-color" in p) {
      p["fill-outline-color"] = l.id.startsWith("park") ? C.parkOutline : C.buildingOut;
    }
  } else if (l.type === "fill-extrusion") {
    p["fill-extrusion-color"] = C.building3d;
  } else if (l.type === "line") {
    if (l.id.startsWith("waterway")) {
      p["line-color"] = C.waterway;
      // Plus épais que Liberty : la Seine et la Marne doivent se suivre d'un
      // coup d'œil dès le zoom de la région.
      if (l.id === "waterway_river") {
        p["line-width"] = ["interpolate", ["exponential", 1.3], ["zoom"], 8, 1, 11, 2, 20, 10];
      }
    } else if (l.id.startsWith("boundary")) {
      p["line-color"] = l.id === "boundary_3" ? C.boundaryRegion : C.boundaryCountry;
      // Discrètes, comme chez Apple : un repère, pas un quadrillage. Première
      // capture : les pointillés roses couvraient toute la banlieue.
      if (l.id === "boundary_3") p["line-opacity"] = 0.55;
    } else if (l.id.startsWith("park")) {
      p["line-color"] = C.parkOutline;
    } else if (has(l.id, "aeroway")) {
      p["line-color"] = C.runway;
    } else {
      p["line-color"] = lineColor(l.id);
      // Le réseau secondaire s'efface aux zooms larges : à l'échelle de la
      // région, il tissait un filet gris sur toute la banlieue (mesuré sur la
      // première capture), là où Apple ne montre que les grands axes.
      if (has(l.id, "secondary", "tertiary") && !has(l.id, "casing")) {
        p["line-opacity"] = ["interpolate", ["linear"], ["zoom"], 9, 0.35, 12, 1];
      }
      // Même chose, en moins marqué, pour les routes principales : très
      // nombreuses en Île-de-France, ce sont elles qui gardaient le filet gris
      // après l'allègement du réseau secondaire (deuxième capture).
      if (has(l.id, "trunk", "primary") && !has(l.id, "casing")) {
        p["line-opacity"] = ["interpolate", ["linear"], ["zoom"], 9, 0.6, 12, 1];
      }
      // Le liseré, lui, est plus large que la route aux zooms larges : c'était
      // lui, bien plus que la route, qui faisait le filet gris (troisième
      // capture). Il n'apparaît qu'à l'échelle de la ville.
      if (has(l.id, "trunk", "primary") && has(l.id, "casing")) {
        p["line-opacity"] = ["interpolate", ["linear"], ["zoom"], 10, 0, 12, 1];
      }
      if (has(l.id, "secondary", "tertiary") && has(l.id, "casing")) {
        p["line-opacity"] = ["interpolate", ["linear"], ["zoom"], 11, 0, 13, 1];
      }
    }
  } else if (l.type === "symbol") {
    p["text-halo-color"] = C.halo;
    p["text-halo-width"] = 1.5;
    delete p["text-halo-blur"];

    if (l.id === "label_city_capital") {
      p["text-color"] = C.textCapital;
      lay["text-font"] = ["Noto Sans Bold"];
      lay["text-size"] = ["interpolate", ["exponential", 1.2], ["zoom"], 4, 13, 7, 16, 11, 26];
    } else if (l.id === "label_city") {
      p["text-color"] = C.textCity;
      lay["text-font"] = ["Noto Sans Bold"];
      lay["text-size"] = ["interpolate", ["exponential", 1.2], ["zoom"], 4, 11, 7, 13, 11, 19];
    } else if (l.id === "label_town") {
      p["text-color"] = C.textTown;
      lay["text-size"] = ["interpolate", ["exponential", 1.2], ["zoom"], 7, 11, 11, 14];
      // De l'air entre les noms : moins de communes à la fois, comme chez Apple.
      lay["text-padding"] = 6;
    } else if (l.id === "label_village") {
      p["text-color"] = C.textVillage;
      lay["text-size"] = ["interpolate", ["exponential", 1.2], ["zoom"], 9, 10, 12, 12];
      lay["text-padding"] = 6;
      l.minzoom = 10.5;
    } else if (l.id === "label_other") {
      p["text-color"] = C.textOther;
      l.minzoom = 12;
    } else if (has(l.id, "water_name", "waterway")) {
      p["text-color"] = C.textWater;
    } else if (l.id === "airport") {
      p["text-color"] = C.textAirport;
    } else if (has(l.id, "highway-name")) {
      p["text-color"] = C.textRoad;
    } else if (l.id === "highway-shield-non-us") {
      // Les cartouches aux couleurs françaises, dessinés par l'application.
      lay["icon-image"] = ["concat", "fr-shield-", shieldColor, "-", ["get", "ref_length"]];
      lay["text-font"] = ["Noto Sans Bold"];
      p["text-color"] = [
        "match",
        shieldColor,
        ["yellow", "white"],
        SHIELD.yellow.text,
        SHIELD.red.text,
      ];
      delete p["text-halo-color"];
      delete p["text-halo-width"];
    } else if (has(l.id, "poi")) {
      p["text-color"] = C.poiText;
    } else if ("text-color" in p || lay["text-field"]) {
      p["text-color"] = C.textOther;
    }
  }
  layers.push(l);
}

const style = {
  version: 8,
  name: "OSM Local — Apple Light",
  metadata: { "osm-local:derived-from": "OpenFreeMap Liberty, retouché façon Apple Plans (clair)" },
  glyphs: base.glyphs,
  sprite: base.sprite,
  sources: base.sources,
  layers,
};

const header =
  "// Généré par `scripts/build-apple-light-style.mjs` — ne pas éditer à la main.\n" +
  "// Style du mode clair : OpenFreeMap Liberty retouché façon Apple Plans.\n" +
  'import type { StyleSpecification } from "maplibre-gl";\n\n' +
  "export const APPLE_LIGHT_STYLE = ";

fs.writeFileSync(OUT, `${header}${JSON.stringify(style, null, 2)} as unknown as StyleSpecification;\n`);
console.log(`Écrit ${OUT} — ${layers.length} couches.`);
