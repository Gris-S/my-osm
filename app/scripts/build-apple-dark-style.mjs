// ---------------------------------------------------------------------------
// Génère `src/styles/appleDark.ts` : le style MapLibre du mode sombre.
//
// On part du style vectoriel OpenFreeMap « Liberty » (mêmes tuiles que le
// mode clair, schéma OpenMapTiles) et on recolore chaque couche façon
// « Apple Plans » sombre. Seules les COULEURS changent — largeurs de traits,
// filtres et interpolations de zoom sont conservés tels quels.
//
// Usage : `node scripts/build-apple-dark-style.mjs`
// À relancer si l'on veut ajuster la palette (constante `C` ci-dessous) ou
// repartir d'une version plus récente du style Liberty.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIBERTY_URL = "https://tiles.openfreemap.org/styles/liberty";
const OUT = path.join(fileURLToPath(new URL("../src/styles/appleDark.ts", import.meta.url)));

// --- Palette « Apple Plans » mode sombre ---------------------------------
const C = {
  land: "#1a1a1d",
  residential: "#202023",
  water: "#182d40",
  wood: "#18271c",
  grass: "#1d2b1e",
  park: "#1a2a1c",
  parkOutline: "#2b4030",
  wetland: "#182422",
  sand: "#272620",
  ice: "#2b2f34",
  cemetery: "#1e251e",
  pitch: "#233220",
  hospital: "#241d20",
  school: "#24221b",
  building: "#26262c",
  buildingOut: "#31313a",
  aeroway: "#2a2a31",
  runway: "#3c3c44",

  roadMinor: "#37373c",
  roadStreet: "#3e3e44",
  roadSec: "#4b4b53",
  roadPrimary: "#5d5d67",
  roadMotorway: "#9a844f",
  casing: "#121214",
  casingMotor: "#4b4130",
  path: "#35353d",
  rail: "#3d3d44",
  railHatch: "#4c4c55",

  boundary: "#55555f",
  boundaryDisp: "#61616b",

  textMajor: "#e8e8ee",
  textMid: "#bcbcc6",
  textMinor: "#8f8f9a",
  textRoad: "#9a9aa4",
  textWater: "#5f7c9e",
  poiText: "#8c8c97",
  halo: "#0b0b0d",
  haloSoft: "rgba(9,9,11,0.8)",
};

const has = (id, ...subs) => subs.some((s) => id.includes(s));

function lineColor(id) {
  if (has(id, "rail")) return has(id, "hatching") ? C.railHatch : C.rail;
  if (has(id, "path", "pedestrian", "track", "service")) return C.path;
  if (has(id, "motorway")) return has(id, "casing") ? C.casingMotor : C.roadMotorway;
  if (has(id, "trunk", "primary")) return has(id, "casing") ? C.casing : C.roadPrimary;
  if (has(id, "secondary", "tertiary")) return has(id, "casing") ? C.casing : C.roadSec;
  if (has(id, "street", "minor", "link")) return has(id, "casing") ? C.casing : C.roadStreet;
  return has(id, "casing") ? C.casing : C.roadMinor;
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
  if (has(id, "aeroway", "runway", "taxiway")) return has(id, "fill") ? C.aeroway : C.runway;
  if (has(id, "water")) return C.water;
  return C.land;
}

function textColors(id) {
  if (has(id, "country", "state")) return [C.textMajor, C.halo];
  if (has(id, "city", "capital")) return [C.textMajor, C.halo];
  if (has(id, "town")) return [C.textMid, C.halo];
  if (has(id, "village", "label_other", "airport")) return [C.textMinor, C.halo];
  if (has(id, "water_name", "waterway")) return [C.textWater, C.haloSoft];
  if (has(id, "highway-name", "road_shield", "highway-shield")) return [C.textRoad, C.halo];
  if (has(id, "poi")) return [C.poiText, C.halo];
  return [C.textMinor, C.halo];
}

const base = await fetch(LIBERTY_URL).then((r) => {
  if (!r.ok) throw new Error(`Téléchargement du style Liberty échoué (${r.status})`);
  return r.json();
});

const layers = [];
for (const layer of base.layers) {
  if (layer.id === "natural_earth") continue; // ombrage Natural Earth : parasite en sombre
  const l = structuredClone(layer);
  const p = l.paint || (l.paint = {});

  if (l.type === "background") {
    p["background-color"] = C.land;
  } else if (l.type === "fill") {
    // Les motifs hachurés du sprite (zones piétonnes, marais) sont trop clairs
    // sur fond sombre : on les remplace par un aplat discret.
    if ("fill-pattern" in p) {
      delete p["fill-pattern"];
      p["fill-color"] = has(l.id, "wetland") ? C.wetland : C.residential;
      p["fill-opacity"] = 0.5;
    } else {
      p["fill-color"] = fillColor(l.id);
      if (has(l.id, "wood", "grass", "park", "wetland")) p["fill-opacity"] = 0.9;
    }
    if ("fill-outline-color" in p) {
      p["fill-outline-color"] = l.id.startsWith("park") ? C.parkOutline : C.buildingOut;
    }
  } else if (l.type === "fill-extrusion") {
    p["fill-extrusion-color"] = C.building;
  } else if (l.type === "line") {
    p["line-color"] = lineColor(l.id);
  } else if (l.type === "symbol") {
    const [tc, hc] = textColors(l.id);
    if ("text-color" in p || l.layout?.["text-field"]) p["text-color"] = tc;
    p["text-halo-color"] = hc;
    if (!("text-halo-width" in p)) p["text-halo-width"] = 1;
    // Pastilles POI un peu adoucies sur fond sombre (le sprite reste clair).
    if (has(l.id, "poi")) p["icon-opacity"] = 0.9;
  } else if (l.type === "raster") {
    p["raster-opacity"] = 0;
  }
  layers.push(l);
}

const style = {
  version: 8,
  name: "OSM Local — Apple Dark",
  metadata: { "osm-local:derived-from": "OpenFreeMap Liberty, recoloré façon Apple Plans (sombre)" },
  glyphs: base.glyphs,
  sprite: base.sprite,
  sources: base.sources,
  layers,
};

const header =
  "// Généré par `scripts/build-apple-dark-style.mjs` — ne pas éditer à la main.\n" +
  "// Style du mode sombre : OpenFreeMap Liberty recoloré façon Apple Plans.\n" +
  'import type { StyleSpecification } from "maplibre-gl";\n\n' +
  "export const APPLE_DARK_STYLE = ";

fs.writeFileSync(OUT, `${header}${JSON.stringify(style, null, 2)} as unknown as StyleSpecification;\n`);
console.log(`Écrit ${OUT} — ${layers.length} couches.`);
