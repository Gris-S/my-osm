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

/** `breakdown` ne vient que de la couche d'incidents (`incidents.ts`), jamais de l'itinéraire. */
export type IncidentKind = "roadworks" | "closure" | "accident" | "incident" | "breakdown";

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
  /**
   * `cycleway` n'est pas du trafic : c'est une portion **sur piste ou bande
   * cyclable**, dessinée en vert sur un parcours à vélo (`useNavigation`). Elle
   * passe par la même couche que les bouchons, qui sait déjà colorer des
   * morceaux de tracé, pendant le choix comme pendant la navigation.
   */
  level: TrafficLevel | "cycleway";
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

export const INCIDENT_LABEL = {
  roadworks: "car.incident.roadworks",
  closure: "car.incident.closure",
  accident: "car.incident.accident",
  incident: "car.incident.other",
  breakdown: "car.incident.breakdown",
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

/** Un ralentissement repéré en **mètres le long du parcours suivi**, pour la jauge du bandeau. */
export interface TrafficSpan {
  fromMeters: number;
  toMeters: number;
  level: TrafficLevel;
  delaySeconds: number;
}

/**
 * Les ralentissements d'un itinéraire, en mètres depuis son départ.
 *
 * `offsetMeters` sert au parcours **épinglé** d'une réévaluation : il part de
 * là où l'on était, pas du départ du trajet suivi, et ses mètres se décalent
 * donc d'autant pour se lire sur la même règle.
 */
export function trafficSpans(route: Pick<CarRoute, "measures" | "traffic">, offsetMeters = 0): TrafficSpan[] {
  const last = route.measures.length - 1;
  const at = (index: number) => offsetMeters + (route.measures[Math.min(last, Math.max(0, index))] ?? 0);
  const spans: TrafficSpan[] = [];
  for (const section of route.traffic) {
    if (!section.level) continue;
    const fromMeters = at(section.startIndex);
    const toMeters = at(section.endIndex);
    if (toMeters > fromMeters) spans.push({ fromMeters, toMeters, level: section.level, delaySeconds: section.delaySeconds });
  }
  return spans.sort((a, b) => a.fromMeters - b.fromMeters);
}

/** En deçà de cette longueur restante, un ralentissement se dessine mais ne se dit pas, en mètres. */
const GAUGE_TEXT_METERS = 200;

/** Ce que la jauge dessine : des parts du trajet **restant**, de 0 (la voiture) à 1 (l'arrivée). */
export interface GaugeView {
  parts: { start: number; size: number; level: TrafficLevel }[];
  /**
   * Le ralentissement où l'on est, ou le prochain : sa distance, ce qu'il en
   * reste, ce qu'il coûte. `null` si ceux qui restent sont trop courts pour
   * mériter une phrase (`GAUGE_TEXT_METERS`).
   */
  next: { inside: boolean; meters: number; delaySeconds: number; level: TrafficLevel } | null;
}

/**
 * La jauge, vue d'où l'on est. `null` s'il n'y a plus de ralentissement
 * devant : elle n'existe que s'il y a quelque chose à montrer.
 */
export function gaugeView(spans: TrafficSpan[], traveledMeters: number, totalMeters: number): GaugeView | null {
  const remaining = totalMeters - traveledMeters;
  const ahead = spans.filter((span) => span.toMeters > traveledMeters);
  if (remaining <= 0 || !ahead.length) return null;
  const parts = ahead.map((span) => {
    const from = Math.max(span.fromMeters, traveledMeters);
    return {
      start: (from - traveledMeters) / remaining,
      size: Math.min(1, (span.toMeters - from) / remaining),
      level: span.level,
    };
  });
  // La phrase ne parle que de ce qui compte : constaté sur le téléphone, la
  // jauge annonçait « encore 46 m » pour un feu au départ, alors que le vrai
  // bouchon était à treize kilomètres.
  const first = ahead.find((span) => span.toMeters - Math.max(span.fromMeters, traveledMeters) >= GAUGE_TEXT_METERS);
  if (!first) return { parts, next: null };
  const inside = first.fromMeters <= traveledMeters;
  const length = first.toMeters - first.fromMeters;
  return {
    parts,
    next: {
      inside,
      level: first.level,
      meters: inside ? first.toMeters - traveledMeters : first.fromMeters - traveledMeters,
      // Dans le bouchon, le retard qui reste est la part de sa longueur qui reste.
      delaySeconds: inside ? first.delaySeconds * ((first.toMeters - traveledMeters) / length) : first.delaySeconds,
    },
  };
}
