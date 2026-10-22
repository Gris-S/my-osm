import type { Map as MLMap, GeoJSONSource, PointLike } from "maplibre-gl";
import { BIKE_ICON, type IconNode } from "../filters";
import { buildPillImage, type PillStyle } from "../utils/markerImage";
import type { BikeStation } from "./bikes";
import type { Charger, FuelStation, LiquidFuel } from "./fuel";
import { isStale, shortPrice } from "./format";

// ---------------------------------------------------------------------------
// Les repères des modes en direct sur la carte.
//
// Deux sources GeoJSON, chacune avec deux couches : des **points** à toutes
// les échelles, et par-dessus des **étiquettes** — pictogramme et chiffre —
// qui se décombrent entre elles. Une étiquette évincée laisse donc son point :
// aucune station ne disparaît, même au cœur de Paris.
//
// Les étiquettes sont des images dessinées à la demande et nommées d'après ce
// qu'elles montrent (`live:fuel:cheap:1,99`) : deux stations au même prix
// partagent la leur. Elles sont ajoutées **avant** les données, pas par le
// résolveur d'images manquantes, que la carte réserve aux cartouches de route
// (`map/roadShields.ts` — une carte n'en a qu'un).
//
// Sources et couches sont posées et retirées avec le mode, jamais masquées, et
// reposées après chaque changement de style (`MapView`, `style.load`).
// ---------------------------------------------------------------------------

export const LIVE_BIKES_SOURCE = "live-bikes";
export const LIVE_FUEL_SOURCE = "live-fuel";
const DOTS = "-dots";
const PILLS = "-pills";
export const LIVE_LAYERS = [LIVE_BIKES_SOURCE, LIVE_FUEL_SOURCE].flatMap((id) => [id + DOTS, id + PILLS]);

/** En deçà du zoom d'ouverture, les vélos et les bornes ne sont que des points : ils sont des centaines. */
export const LIVE_PILL_ZOOM = 14;

export const FUEL_ICON: IconNode = [
  ["path", { d: "M3 22h12" }],
  ["path", { d: "M4 9h10" }],
  ["path", { d: "M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" }],
  ["path", { d: "M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5" }],
];

export const CHARGER_ICON: IconNode = [
  ["path", { d: "M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" }],
  ["path", { d: "m2 22 3-3" }],
  ["path", { d: "M7.5 13.5 10 11" }],
  ["path", { d: "M10.5 16.5 13 14" }],
  ["path", { d: "m18 3-4 4h6l-4 4" }],
];

/** Les couleurs des repères. Celles d'iOS, comme le reste de l'interface. */
export const LIVE_COLORS = {
  bike: "#34C759",
  bikeLow: "#FF9500",
  empty: "#8E8E93",
  ebike: "#5E5CE6",
  fuel: "#3A3A3C",
  cheap: "#34C759",
  stale: "#FF9500",
  charger: "#30B0C7",
};

/** Sous ce nombre de vélos, la station passe à l'orange : il n'en restera peut-être plus. */
export const BIKES_LOW = 3;
/** Une borne à partir de cette puissance charge vite : elle est cerclée. */
export const FAST_KW = 50;

/** Ce que l'on a touché sur la carte. */
export type LivePick = { kind: "bike" | "fuel" | "charger"; id: string };

function ensureImage(map: MLMap, id: string, icon: IconNode, label: string, style: PillStyle) {
  if (map.hasImage(id)) return;
  const ratio = window.devicePixelRatio || 1;
  map.addImage(id, buildPillImage(icon, label, style, ratio), { pixelRatio: ratio });
}

export function bikeColor(s: BikeStation): string {
  const total = s.mechanical + s.electric;
  return !s.open || total === 0 ? LIVE_COLORS.empty : total < BIKES_LOW ? LIVE_COLORS.bikeLow : LIVE_COLORS.bike;
}

function bikeFeatures(map: MLMap, stations: BikeStation[]): GeoJSON.Feature[] {
  return stations.map((s) => {
    const total = s.mechanical + s.electric;
    const color = bikeColor(s);
    const img = `live:bike:${color}:${total}:${s.electric > 0 ? "e" : ""}`;
    ensureImage(map, img, BIKE_ICON, String(total), {
      background: color,
      color: "#ffffff",
      dot: s.electric > 0 ? "#ffffff" : undefined,
    });
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { kind: "bike", id: s.id, img, color, sort: -total },
    };
  });
}

/** Le prix le plus bas de la zone pour ce carburant, ou `null`. */
export function cheapestPrice(stations: FuelStation[], fuel: LiquidFuel): number | null {
  let best: number | null = null;
  for (const s of stations) {
    const p = s.prices[fuel];
    if (p && (best === null || p.price < best)) best = p.price;
  }
  return best;
}

function fuelFeatures(map: MLMap, stations: FuelStation[], fuel: LiquidFuel, now: number): GeoJSON.Feature[] {
  const best = cheapestPrice(stations, fuel);
  return stations.flatMap((s) => {
    const p = s.prices[fuel];
    // Une station qui ne vend pas ce carburant (ou en manque) garde une
    // étiquette grise : sans elle, on la croirait absente de la carte.
    if (!p) {
      const img = "live:fuel:none";
      ensureImage(map, img, FUEL_ICON, "—", { background: "#ffffff", color: LIVE_COLORS.empty });
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
        properties: { kind: "fuel", id: s.id, img, color: LIVE_COLORS.empty, sort: 1000 },
      }];
    }
    const cheap = p.price === best;
    const stale = isStale(p.at, now);
    const label = shortPrice(p);
    const img = `live:fuel:${cheap ? "cheap" : "plain"}:${stale ? "stale" : ""}:${label}`;
    ensureImage(map, img, FUEL_ICON, label, {
      background: cheap ? LIVE_COLORS.cheap : "#ffffff",
      color: cheap ? "#ffffff" : LIVE_COLORS.fuel,
      dot: stale ? LIVE_COLORS.stale : undefined,
    });
    return [{
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      properties: { kind: "fuel", id: s.id, img, color: cheap ? LIVE_COLORS.cheap : LIVE_COLORS.fuel, sort: p.price },
    }];
  });
}

function chargerFeatures(map: MLMap, chargers: Charger[]): GeoJSON.Feature[] {
  return chargers.map((c) => {
    const label = c.powerKw ? `${Math.round(c.powerKw)} kW` : "";
    const fast = (c.powerKw ?? 0) >= FAST_KW;
    const img = `live:charger:${fast ? "fast" : ""}:${label}`;
    ensureImage(map, img, CHARGER_ICON, label, { background: LIVE_COLORS.charger, color: "#ffffff", ring: fast });
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      properties: { kind: "charger", id: c.id, img, color: LIVE_COLORS.charger, sort: -(c.powerKw ?? 0) },
    };
  });
}

function setSource(map: MLMap, id: string, features: GeoJSON.Feature[] | null, pillZoom: number) {
  if (!features) {
    for (const layer of [id + PILLS, id + DOTS]) if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(id)) map.removeSource(id);
    return;
  }
  const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    // Prix et bornes partagent la source, pas l'échelle de leurs étiquettes.
    if (map.getLayer(id + PILLS)) map.setLayerZoomRange(id + PILLS, pillZoom, 24);
    return;
  }
  map.addSource(id, { type: "geojson", data });
  map.addLayer({
    id: id + DOTS,
    type: "circle",
    source: id,
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 6],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: id + PILLS,
    type: "symbol",
    source: id,
    minzoom: pillZoom,
    layout: {
      "icon-image": ["get", "img"],
      "icon-anchor": "bottom",
      "icon-offset": [0, -2],
      // Les étiquettes se décombrent ; le prix le plus bas et la station la
      // mieux fournie passent devant.
      "symbol-sort-key": ["get", "sort"],
      "icon-padding": 1,
    },
  });
}

export interface LiveLayers {
  bikes: BikeStation[] | null;
  fuel: { stations: FuelStation[]; fuel: LiquidFuel } | null;
  chargers: Charger[] | null;
}

/** Pose, met à jour ou retire les repères. `null` retire la couche. */
export function applyLive(map: MLMap, live: LiveLayers, now = Date.now()) {
  setSource(map, LIVE_BIKES_SOURCE, live.bikes ? bikeFeatures(map, live.bikes) : null, LIVE_PILL_ZOOM);
  const fuel = live.chargers
    ? chargerFeatures(map, live.chargers)
    : live.fuel
      ? fuelFeatures(map, live.fuel.stations, live.fuel.fuel, now)
      : null;
  // Les prix sont peu nombreux : leurs étiquettes s'affichent dès le zoom des modes.
  setSource(map, LIVE_FUEL_SOURCE, fuel, live.chargers ? LIVE_PILL_ZOOM : 0);
}

/** Le repère touché, étiquette d'abord, point ensuite. */
export function pickLive(map: MLMap, point: PointLike): LivePick | null {
  const layers = LIVE_LAYERS.filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const hit = map.queryRenderedFeatures(point, { layers })[0]?.properties;
  const kind = hit?.kind;
  if ((kind === "bike" || kind === "fuel" || kind === "charger") && typeof hit?.id === "string") return { kind, id: hit.id };
  return null;
}
