import { CONFIG } from "../../config";
import type { LonLat } from "../../types";
import { rescuedFetch } from "../../services/native";
import { navText } from "../strings";
import { locateOnPath } from "../progress";
import type { CarRoute } from "./carRoute";
import type { IncidentKind, TrafficIncident } from "./carTraffic";

// ---------------------------------------------------------------------------
// Les incidents **sans bouchon** sur le parcours : accident, véhicule en panne,
// danger (demande explicite, 13 octobre 2026).
//
// L'itinéraire de TomTom ne rapporte que ce qui ralentit (`sectionType=traffic`,
// voir `carTraffic.ts`) : un accident dégagé sur la bande d'arrêt d'urgence ou
// une voiture en panne sur le bas-côté n'y figurent pas, et la carte n'en
// montrait donc jamais. Ils sont dans une autre API, *Incident Details*
// (vérifiée dans sa documentation le 13 octobre 2026 : version 5, `bbox` en
// `minLon,minLat,maxLon,maxLat`, 10 000 km² au plus, origine croisée
// autorisée), interrogée ici sur le couloir des kilomètres à venir — pendant
// la navigation seulement, avec la réévaluation de trois minutes.
//
// **Ce n'est pas Waze** : TomTom n'a pas les signalements des conducteurs.
// Tout ce qu'on voit au bord de la route n'y sera pas.
// ---------------------------------------------------------------------------

/** Jusqu'où l'on regarde devant la voiture, en mètres. */
export const INCIDENTS_AHEAD_METERS = 40_000;

/** Écart au tracé en deçà duquel un incident est **sur** le parcours, en mètres. */
const ON_ROUTE_METERS = 40;

/** Surface maximale d'une emprise, imposée par l'API, en km². */
const MAX_BBOX_KM2 = 10_000;

/**
 * Les familles demandées, et ce qu'elles deviennent ici (`iconCategory` de
 * l'API : 1 accident, 3 conditions dangereuses, 14 véhicule en panne). Les
 * bouchons, travaux et fermetures viennent déjà de l'itinéraire lui-même.
 */
const KINDS: Record<number, IncidentKind> = { 1: "accident", 3: "incident", 14: "breakdown" };

const LABELS = {
  accident: "car.incident.accident",
  incident: "car.incident.other",
  breakdown: "car.incident.breakdown",
  roadworks: "car.incident.roadworks",
  closure: "car.incident.closure",
} as const;

type Bbox = [number, number, number, number];

/** L'emprise du tracé entre deux avancements, marge comprise, et sa surface en km². */
export function corridorBbox(route: Pick<CarRoute, "points" | "measures">, fromMeters: number, toMeters: number): { bbox: Bbox; km2: number } | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (let i = 0; i < route.points.length; i++) {
    if (route.measures[i] < fromMeters) continue;
    if (route.measures[i] > toMeters) break;
    const { lon, lat } = route.points[i];
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (west === Infinity) return null;
  const margin = 0.005;
  const bbox: Bbox = [west - margin, south - margin, east + margin, north + margin];
  const height = (bbox[3] - bbox[1]) * 110.574;
  const width = (bbox[2] - bbox[0]) * 111.32 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180);
  return { bbox, km2: width * height };
}

interface IncidentFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: { iconCategory?: number };
}

/** Le point d'un incident : le sien, ou le début de son tronçon. */
function pointOf(feature: IncidentFeature): LonLat | null {
  const coordinates = feature.geometry?.coordinates;
  const first = feature.geometry?.type === "Point" ? coordinates : Array.isArray(coordinates) ? coordinates[0] : null;
  if (!Array.isArray(first) || typeof first[0] !== "number" || typeof first[1] !== "number") return null;
  return { lon: first[0], lat: first[1] };
}

/**
 * Ce que la réponse rapporte **sur le parcours, devant** : fonction pure,
 * testée. Un incident de la rue d'à côté, ou derrière soi, est écarté.
 */
export function readIncidents(
  data: { incidents?: IncidentFeature[] } | null,
  route: Pick<CarRoute, "points" | "measures">,
  fromMeters: number,
): TrafficIncident[] {
  const found: TrafficIncident[] = [];
  for (const feature of data?.incidents ?? []) {
    const kind = KINDS[feature.properties?.iconCategory ?? -1];
    const point = pointOf(feature);
    if (!kind || !point) continue;
    const match = locateOnPath(route, point);
    if (match.offset > ON_ROUTE_METERS || match.measure < fromMeters) continue;
    found.push({ lon: point.lon, lat: point.lat, kind, label: navText(LABELS[kind]) });
  }
  return found;
}

/** Les incidents du couloir devant la voiture. Lève si le service ne répond pas. */
export async function fetchCorridorIncidents(route: CarRoute, fromMeters: number, signal: AbortSignal): Promise<TrafficIncident[]> {
  // L'emprise d'un long tronçon en diagonale dépasse vite la limite : on
  // raccourcit le regard jusqu'à ce qu'elle tienne.
  let ahead = INCIDENTS_AHEAD_METERS;
  let corridor = corridorBbox(route, fromMeters, fromMeters + ahead);
  while (corridor && corridor.km2 > MAX_BBOX_KM2 && ahead > 5_000) {
    ahead /= 2;
    corridor = corridorBbox(route, fromMeters, fromMeters + ahead);
  }
  if (!corridor || corridor.km2 > MAX_BBOX_KM2) return [];
  const query = new URLSearchParams({
    key: CONFIG.TOMTOM_KEY,
    bbox: corridor.bbox.map((value) => value.toFixed(5)).join(","),
    fields: "{incidents{geometry{type,coordinates},properties{iconCategory}}}",
    categoryFilter: Object.keys(KINDS).join(","),
    timeValidityFilter: "present",
  });
  const res = await rescuedFetch(`${CONFIG.TOMTOM_INCIDENTS_URL}?${query}`, { signal });
  if (!res.ok) throw new Error(`Incidents TomTom : ${res.status}`);
  return readIncidents(await res.json(), route, fromMeters);
}
