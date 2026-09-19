import type { RouteResult, RouteSegment } from "../types";
import { MODE_COLORS } from "./departuresView";
import type { Journey, JourneyLeg, Position, TransitMode } from "./model";

// ---------------------------------------------------------------------------
// Les trajets en transports tels que l'interface les lit.
//
// Le panneau d'itinéraire, son détail et le guidage en transports lisent ces
// formes-ci depuis leur écriture pour Navitia ; elles n'ont pas changé. Ce
// module les **déduit du modèle canonique** (`Journey`), si bien qu'un trajet
// calculé par n'importe quelle source s'affiche et se suit de la même façon.
// Les dates redeviennent des `Date`, et ce qui manque à une source retombe sur
// une valeur neutre plutôt que sur un zéro inventé.
// ---------------------------------------------------------------------------

/** Nature d'une étape du trajet. */
export type TransitLegKind = "walk" | "transit";

/** Ligne empruntée, telle que l'annonce la source (pastille officielle). */
export interface TransitLine {
  label: string;
  color: string;
  textColor: string;
  /** Mode commercial affiché : « Métro », « RER », « Bus »… */
  mode: string;
}

/** Un arrêt desservi par une étape. */
export interface TransitStop {
  /** Nom nu, sans la commune entre parenthèses. */
  name: string;
  lon: number;
  lat: number;
  /** Heure de passage prévue. */
  at: Date;
}

export interface TransitLeg {
  kind: TransitLegKind;
  departure: Date;
  arrival: Date;
  durationSeconds: number;
  from?: string;
  to?: string;
  line?: TransitLine;
  /** Terminus de la course empruntée. */
  direction?: string;
  /** Nombre d'arrêts parcourus, quand la source détaille la desserte. */
  stopCount?: number;
  /**
   * Les arrêts desservis, de la montée à la descente, avec leurs coordonnées et
   * l'heure de passage : ils disent, en cours de route, combien d'arrêts
   * restent et lequel on vient de passer.
   */
  stops?: TransitStop[];
  /** Ligne et quai de montée, pour aller chercher les départs suivants. */
  lineId?: string;
  stopPointId?: string;
  /** Vrai quand l'horaire de l'étape tient compte du temps réel du jour. */
  realtime?: boolean;
  geometry?: GeoJSON.LineString;
  /**
   * Pour une marche : vrai si c'est une **correspondance déclarée** par le
   * réseau (Navitia `transfer`), faux si elle passe par la rue (`street_network`),
   * absent quand la source ne le dit pas. Le guidage en tire s'il faut indiquer
   * une sortie de station.
   */
  connection?: boolean;
}

export interface TransitJourney {
  id: string;
  /** Fournisseur qui a calculé le trajet, pour le dire sous la liste. */
  source?: string;
  departure: Date;
  arrival: Date;
  durationSeconds: number;
  transfers: number;
  /** Marche cumulée, temps d'accès et correspondances compris. */
  walkingSeconds: number;
  legs: TransitLeg[];
  /**
   * Indices des étapes après lesquelles on atteint un point de passage voulu,
   * quand le parcours en comporte (voir `stitchJourneys`). C'est ce qui
   * distingue, dans le détail du trajet, une correspondance subie d'un arrêt
   * demandé — le panneau y intercale le nom de l'étape.
   */
  stopoverAfter?: number[];
}

const seconds = (from: number, to: number) => Math.round((to - from) / 1000);

/**
 * Le libellé de mode d'une source qui ne l'écrit pas. Il n'est pas affiché :
 * le guidage le lit pour savoir si l'on descend d'un mode fermé (métro, RER,
 * train), où chercher une sortie de station a un sens.
 */
const MODE_LABELS: Record<TransitMode, string> = {
  metro: "Métro",
  "regional-rail": "RER",
  rail: "Train",
  funicular: "Funiculaire",
  tram: "Tramway",
  bus: "Bus",
  coach: "Car",
  ferry: "Ferry",
  cable: "Téléphérique",
  other: "",
};

function toTransitLeg(leg: JourneyLeg): TransitLeg {
  const stops = (leg.intermediateStops ?? []).flatMap<TransitStop>((stop) =>
    stop.lat === undefined || stop.lon === undefined
      ? []
      : [{ name: stop.name, lon: stop.lon, lat: stop.lat, at: new Date(stop.arrivalAt ?? stop.departureAt ?? 0) }]
  );
  const line = leg.kind === "transit" && leg.line ? leg.line : undefined;
  const coordinates = leg.shape?.type === "LineString" ? (leg.shape.coordinates as Position[]) : [];
  return {
    kind: leg.kind,
    departure: new Date(leg.departAt),
    arrival: new Date(leg.arriveAt),
    durationSeconds: leg.durationSeconds ?? seconds(leg.departAt, leg.arriveAt),
    from: leg.from.name || undefined,
    to: leg.to.name || undefined,
    line: line && {
      label: line.shortName,
      // Une source sans couleurs officielles prend celle du mode, comme les
      // pastilles des départs.
      color: line.color ?? MODE_COLORS[line.mode].color,
      textColor: line.textColor ?? MODE_COLORS[line.mode].textColor,
      mode: line.modeLabel ?? MODE_LABELS[line.mode],
    },
    direction: leg.headsign || undefined,
    stopCount: leg.stopCount,
    stops: stops.length ? stops : undefined,
    lineId: leg.boarding?.lineId,
    stopPointId: leg.boarding?.stopId,
    realtime: leg.dataQuality === "realtime",
    geometry: coordinates.length ? { type: "LineString", coordinates } : undefined,
    connection: leg.connection,
  };
}

export function toTransitJourney(journey: Journey, index: number): TransitJourney {
  const legs = journey.legs.map(toTransitLeg);
  return {
    id: journey.id ?? `${journey.departAt}-${index}`,
    source: journey.source,
    departure: new Date(journey.departAt),
    arrival: new Date(journey.arriveAt),
    durationSeconds: journey.durationSeconds ?? seconds(journey.departAt, journey.arriveAt),
    transfers: journey.transfers,
    walkingSeconds:
      journey.walkingSeconds ??
      legs.filter((leg) => leg.kind === "walk").reduce((total, leg) => total + leg.durationSeconds, 0),
    legs,
  };
}

/**
 * Recoud en un seul trajet les tronçons d'un parcours à étapes.
 *
 * Les correspondances comptées restent celles des tronçons : s'arrêter à une
 * étape n'est pas subir un changement, c'est le but du voyage. La durée, en
 * revanche, est bien celle du premier départ à la dernière arrivée — elle
 * comprend donc l'attente du véhicule suivant à chaque étape, ce qui est
 * l'honnête réponse à « quand j'y serai ».
 */
export function stitchJourneys(parts: TransitJourney[]): TransitJourney {
  const legs: TransitLeg[] = [];
  const stopoverAfter: number[] = [];
  for (const [index, part] of parts.entries()) {
    legs.push(...part.legs);
    // Après le dernier tronçon on est arrivé, pas en escale.
    if (index < parts.length - 1) stopoverAfter.push(legs.length - 1);
  }
  const departure = parts[0].departure;
  const arrival = parts[parts.length - 1].arrival;
  return {
    id: parts.map((part) => part.id).join("+"),
    source: parts[0].source,
    departure,
    arrival,
    durationSeconds: Math.round((arrival.getTime() - departure.getTime()) / 1000),
    transfers: parts.reduce((total, part) => total + part.transfers, 0),
    walkingSeconds: parts.reduce((total, part) => total + part.walkingSeconds, 0),
    legs,
    stopoverAfter,
  };
}

/** Couleur des portions à pied d'un trajet en transports. */
const WALK_COLOR = "#007AFF";

/**
 * Tracé du trajet choisi : un tronçon par étape, à la couleur de sa ligne, la
 * marche en pointillés. C'est ce qui distingue d'un coup d'œil les cinq
 * minutes à pied du quart d'heure de RER.
 */
export function journeyToRoute(journey: TransitJourney): RouteResult {
  const segments: RouteSegment[] = [];
  for (const leg of journey.legs) {
    if (!leg.geometry) continue;
    segments.push({
      geometry: leg.geometry,
      color: leg.kind === "transit" ? (leg.line?.color ?? WALK_COLOR) : WALK_COLOR,
      dashed: leg.kind === "walk",
    });
  }
  return {
    mode: "transit",
    // La distance parcourue n'a pas de sens ici : seule la marche est mesurée,
    // et l'annoncer se lirait comme la longueur du trajet.
    distanceMeters: null,
    durationSeconds: journey.durationSeconds,
    segments,
  };
}
