// ---------------------------------------------------------------------------
// Génère `src/styles/appleDark.ts` : le style MapLibre du mode sombre.
//
// **Le jumeau du style clair** (`build-apple-light-style.mjs`), refait le
// 13 octobre 2026 sur demande explicite : le sombre n'avait pas suivi la
// refonte du clair du 29 septembre et n'en était qu'une recoloration couche à
// couche. Il en reprend désormais toutes les règles, avec une palette de nuit :
//
// - **les routes ne tissent plus un filet** : sombres au loin, plus claires de
//   près ; le réseau secondaire et les liserés n'apparaissent qu'à l'échelle de
//   la ville ; seules les autoroutes gardent une teinte (gris-lilas) ;
// - **la banlieue ne fait plus tache** : un voile à peine plus clair que le fond ;
// - **forêts, parcs et eau structurent la carte** : verts et bleus profonds
//   mais francs, cours d'eau plus épais ;
// - **les noms de lieux se hiérarchisent** : villes en gras et plus gros,
//   villages plus tard et plus petits, lieux-dits encore plus tard ;
// - **les numéros de route prennent les couleurs françaises**, par les mêmes
//   cartouches que le clair (`map/roadShields.ts`).
//
// **Les deux scripts se retouchent ensemble** : une règle changée dans l'un se
// reporte dans l'autre ; seules la palette `C` et les teintes des routes de
// près (le clair les fait toutes blanches, le sombre garde trois gris)
// diffèrent.
//
// Usage : `npm run build:dark-style` (télécharge Liberty : réseau requis).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIBERTY_URL = "https://tiles.openfreemap.org/styles/liberty";
const OUT = path.join(fileURLToPath(new URL("../src/styles/appleDark.ts", import.meta.url)));

// --- Palette « Apple Plans » sombre ----------------------------------------
// Éclaircie le 13 octobre 2026 (« encore trop sombre ») : le fond était à
// #1c1d21, presque noir ; il est à #292b30, un gris ardoise. Sur un écran OLED
// réglé bas, la nuit, un fond trop proche du noir noie les routes.
const C = {
  land: "#292b30",
  residential: "#2e3036",
  water: "#183352",
  waterway: "#224a73",
  wood: "#20402c",
  grass: "#244630",
  park: "#22432e",
  parkOutline: "#325a40",
  wetland: "#213836",
  sand: "#36332a",
  ice: "#353b42",
  cemetery: "#283528",
  pitch: "#284a30",
  hospital: "#322c34",
  school: "#343126",
  building: "#33353c",
  buildingOut: "#3f4149",
  building3d: "#383a42",
  aeroway: "#30333c",
  runway: "#474b57",

  // Routes : sombres au loin, plus claires de près (voir `zoomed`). Trois gris
  // de près, là où le clair n'a que du blanc : sur fond sombre, c'est la
  // clarté qui dit l'importance d'une rue.
  motorwayFar: "#66628a",
  motorwayNear: "#7d79a3",
  motorwayCasing: "#34324a",
  primaryFar: "#4a4c55",
  secondaryFar: "#42444c",
  roadNear: "#666872",
  roadSecondary: "#595b65",
  roadMinor: "#494b54",
  casingMajor: "#1d1e22",
  casingMinor: "#202126",
  path: "#474952",
  rail: "#54565f",

  boundaryRegion: "#6b4a66",
  boundaryCountry: "#8a6a86",

  textCapital: "#f2f2f7",
  textCity: "#f2f2f7",
  textTown: "#d8d8de",
  textVillage: "#a8a8b2",
  textOther: "#8e8e99",
  textRoad: "#a0a0aa",
  textWater: "#5b8fc9",
  textAirport: "#6f9be0",
  poiText: "#9a9aa5",
  halo: "rgba(20,21,24,0.9)",
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
  if (has(id, "secondary", "tertiary")) return has(id, "casing") ? C.casingMajor : zoomed(C.secondaryFar, C.roadSecondary, 11, 13);
  if (has(id, "link")) return has(id, "casing") ? C.casingMajor : C.roadNear;
  return has(id, "casing") ? C.casingMinor : C.roadMinor;
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
  // L'ombrage Natural Earth des petits zooms : parasite sur un fond sombre.
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
      p["fill-opacity"] = 0.5;
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
      // Les pastilles du sprite sont claires : un rien adoucies sur fond sombre.
      p["icon-opacity"] = 0.9;
    } else if ("text-color" in p || lay["text-field"]) {
      p["text-color"] = C.textOther;
    }
  }
  if (l.type === "raster") p["raster-opacity"] = 0;
  layers.push(l);
}

const style = {
  version: 8,
  name: "OSM Local — Apple Dark",
  metadata: { "osm-local:derived-from": "OpenFreeMap Liberty, retouché façon Apple Plans (sombre)" },
  glyphs: base.glyphs,
  sprite: base.sprite,
  sources: base.sources,
  layers,
};

const header =
  "// Généré par `scripts/build-apple-dark-style.mjs` — ne pas éditer à la main.\n" +
  "// Style du mode sombre : OpenFreeMap Liberty retouché façon Apple Plans.\n" +
  'import type { StyleSpecification } from "maplibre-gl";\n\n' +
  "export const APPLE_DARK_STYLE = ";

fs.writeFileSync(OUT, `${header}${JSON.stringify(style, null, 2)} as unknown as StyleSpecification;\n`);
console.log(`Écrit ${OUT} — ${layers.length} couches.`);
