import type { LonLat } from "../../types";
import { distance } from "../geo";
import { navText } from "../strings";
import type { CarRoute } from "./carRoute";

// ---------------------------------------------------------------------------
// Le trafic sur un itinéraire voiture : ce qui ralentit, ce qui bouche, et ce
// qui se trouve sur la route — travaux, fermetures, accidents.
//
// **Tout vient de l'itinéraire lui-même** (`sectionType=traffic` de TomTom), et
// non d'une API d'incidents à part : c'est ce qui est sur **notre** parcours
// (demande explicite), sans un appel de plus, et rafraîchi avec la
// réévaluation de trois minutes. Constaté le jour où la question s'est posée :
// TomTom connaissait les travaux de la D86 que le conducteur a trouvés sur sa
// route, et l'application ne les demandait pas.
//
// Ce que TomTom rend, mesuré sur Paris → Créteil et le long de la D86 :
// `simpleCategory` (`JAM`, `ROAD_WORK`, `ROAD_CLOSURE`, `OTHER`),
// `magnitudeOfDelay` (0 inconnu, 1 faible, 2 moyen, 3 fort, 4 non chiffré —
// celui des travaux et des fermetures), `delayInSeconds`, `effectiveSpeedInKmh`
// et les causes TPEG (`tec.causes[].mainCauseCode` : 1 circulation, 2 accident,
// 3 travaux). Un bouchon peut avoir des travaux pour cause — `[1, 3]`, relevé
// sur la D86 — et porte alors les deux : la couleur et le repère.
// ---------------------------------------------------------------------------

/** Orange : ça roule mal. Rouge : ça bouche. */
export type TrafficLevel = "slow" | "jam";

export type IncidentKind = "roadworks" | "closure" | "accident" | "incident";

/** Un tronçon de trafic de l'itinéraire, par rang de points sur son tracé. */
export interface TrafficSection {
  startIndex: number;
  endIndex: number;
  /** Couleur du tronçon, `null` s'il ne ralentit pas (une fermeture, des travaux sans retard). */
  level: TrafficLevel | null;
  /** Repère à poser, `null` pour un simple ralentissement. */
  incident: IncidentKind | null;
  delaySeconds: number;
}

/** Un morceau de tracé à colorer. */
export interface TrafficSegment {
  geometry: GeoJSON.LineString;
  level: TrafficLevel;
}

/** Un repère d'incident sur le parcours. */
export interface TrafficIncident {
  lon: number;
  lat: number;
  kind: IncidentKind;
  /** Libellé, pour l'infobulle et la synthèse vocale. */
  label: string;
}

/** Ce que la carte dessine pendant la navigation. */
export interface CarTraffic {
  segments: TrafficSegment[];
  incidents: TrafficIncident[];
}

/** La section telle que TomTom l'écrit — les seuls champs lus. */
export interface TomTomTrafficSection {
  startPointIndex: number;
  endPointIndex: number;
  simpleCategory?: string;
  magnitudeOfDelay?: number;
  delayInSeconds?: number;
  tec?: { causes?: { mainCauseCode?: number }[] };
}

/** Causes TPEG qui méritent leur propre repère. */
const CAUSE_INCIDENT: Record<number, IncidentKind> = {
  2: "accident",
  3: "roadworks",
};

function levelOf(magnitude: number | undefined): TrafficLevel | null {
  if (magnitude === 1) return "slow";
  if (magnitude === 2 || magnitude === 3) return "jam";
  return null;
}

/** Lit une section `TRAFFIC` ; `null` si elle ne dit rien d'affichable. */
export function readTrafficSection(section: TomTomTrafficSection): TrafficSection | null {
  const fromCause =
    (section.tec?.causes ?? [])
      .map((cause) => (cause.mainCauseCode === undefined ? undefined : CAUSE_INCIDENT[cause.mainCauseCode]))
      .find((kind) => kind !== undefined) ?? null;

  let level = levelOf(section.magnitudeOfDelay);
  let incident: IncidentKind | null;
  switch (section.simpleCategory) {
    case "JAM":
      // Un bouchon d'ampleur inconnue reste un ralentissement : on ne tait pas
      // ce que la source signale.
      level = level ?? "slow";
      incident = fromCause;
      break;
    case "ROAD_WORK":
      incident = "roadworks";
      break;
    case "ROAD_CLOSURE":
      // Une route fermée ne « ralentit » pas : on n'y passe pas. Le repère dit tout.
      level = null;
      incident = "closure";
      break;
    default:
      incident = fromCause ?? "incident";
  }

  if (!level && !incident) return null;
  return {
    startIndex: section.startPointIndex,
    endIndex: section.endPointIndex,
    level,
    incident,
    delaySeconds: section.delayInSeconds ?? 0,
  };
}

/** Le tracé entre deux rangs de points, bornes comprises. */
function slice(route: CarRoute, from: number, to: number): GeoJSON.LineString | null {
  const points = route.points.slice(Math.max(0, from), Math.min(route.points.length, to + 1));
  return points.length >= 2 ? { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) } : null;
}

/** Les morceaux de tracé à colorer — c'est tout ce que montre le choix d'itinéraire. */
export function trafficSegments(route: CarRoute): TrafficSegment[] {
  const segments: TrafficSegment[] = [];
  for (const section of route.traffic) {
    if (!section.level) continue;
    const geometry = slice(route, section.startIndex, section.endIndex);
    if (geometry) segments.push({ geometry, level: section.level });
  }
  return segments;
}

/**
 * Deux repères de même nature plus proches que cela n'en font qu'un : un
 * chantier que la source découpe en tronçons consécutifs ne doit pas aligner
 * trois cônes à la file.
 */
const INCIDENT_MERGE_METERS = 150;

const INCIDENT_LABEL = {
  roadworks: "car.incident.roadworks",
  closure: "car.incident.closure",
  accident: "car.incident.accident",
  incident: "car.incident.other",
} as const;

/** Les couleurs et les repères d'un itinéraire, pour la navigation. */
export function trafficOverlay(route: CarRoute): CarTraffic {
  const incidents: TrafficIncident[] = [];
  for (const section of route.traffic) {
    const kind = section.incident;
    if (!kind) continue;
    const at: LonLat = route.points[Math.min(route.points.length - 1, Math.max(0, section.startIndex))];
    if (incidents.some((placed) => placed.kind === kind && distance(placed, at) < INCIDENT_MERGE_METERS)) continue;
    incidents.push({ lon: at.lon, lat: at.lat, kind, label: navText(INCIDENT_LABEL[kind]) });
  }
  return { segments: trafficSegments(route), incidents };
}
