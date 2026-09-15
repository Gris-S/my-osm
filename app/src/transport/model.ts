// ---------------------------------------------------------------------------
// Le modèle canonique des transports (voir `docs/ARCHITECTURE-API.md`, §2b).
//
// Toutes les sources — IDFM, Transitous, et celles qui viendront — sont
// ramenées à ces types par leur adaptateur. Aucun composant ne voit une réponse
// brute : c'est ce qui permet d'ajouter une ville sans toucher à l'interface.
//
// Chaque objet dit d'où il vient, ce qu'il vaut et quand il a été lu
// (`Provenance`). La qualité est portée objet par objet, parce qu'une même
// réponse mêle souvent temps réel et horaires théoriques.
// ---------------------------------------------------------------------------

/** Longitude, latitude — même ordre que GeoJSON. */
export type Position = [number, number];

/** Emprise `[ouest, sud, est, nord]`, en degrés. */
export type BBox = [number, number, number, number];

export type RegionId = string;
export type ProviderId = string;
/** Renvoie à une entrée de « Sources et licences » (menu principal). */
export type AttributionId = string;
/** `<région>:<type>:<clé>` (voir §2b du document d'architecture). */
export type CanonicalId = string;

export type DataQuality = "realtime" | "scheduled" | "estimated" | "unknown";

export interface Provenance {
  source: ProviderId;
  dataQuality: DataQuality;
  /** Instant de lecture, en millisecondes. */
  fetchedAt: number;
  attribution: AttributionId;
  /** Identifiants d'origine, conservés après une fusion. */
  originIds: string[];
}

export type TransitMode =
  | "metro"
  | "tram"
  | "bus"
  | "rail"
  | "regional-rail"
  | "ferry"
  | "funicular"
  | "cable"
  | "coach"
  | "other";

export interface Shape {
  type: "LineString" | "MultiLineString";
  coordinates: Position[] | Position[][];
}

export interface Place extends Provenance {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Une référence légère de ligne, pour les pastilles d'un arrêt. */
export interface LineRef {
  id: CanonicalId;
  shortName: string;
  mode: TransitMode;
  /** Le mode tel que la source l'écrit (« Métro », « RER ») : c'est lui qu'on affiche. */
  modeLabel?: string;
  color?: string;
  textColor?: string;
}

/** Le parent : un seul marqueur sur la carte. */
export interface Station extends Provenance {
  id: CanonicalId;
  name: string;
  lat: number;
  lon: number;
  modes: TransitMode[];
  quays: Quay[];
  lines: LineRef[];
  regionId: RegionId;
}

/** L'enfant : quai, poteau, voie. */
export interface Quay extends Provenance {
  id: CanonicalId;
  stationId: CanonicalId;
  name: string;
  lat: number;
  lon: number;
  modes: TransitMode[];
  /** Repère affiché sur place : « 10a », « K ». */
  code?: string;
}

export interface Line extends Provenance {
  id: CanonicalId;
  shortName: string;
  longName?: string;
  mode: TransitMode;
  /** Absentes chez certaines sources : l'interface retombe sur la couleur du mode. */
  color?: string;
  textColor?: string;
  operator?: string;
}

export interface Route extends Provenance {
  id: CanonicalId;
  lineId: CanonicalId;
  direction?: string;
  shape?: Shape;
}

export interface TripStop {
  quayId?: CanonicalId;
  /** Vide quand la source ne le donne pas. */
  name: string;
  /** Absentes quand la source ne situe pas l'arrêt : jamais un zéro inventé. */
  lat?: number;
  lon?: number;
  arrivalAt?: number;
  departureAt?: number;
}

export interface Trip extends Provenance {
  id: string;
  lineId: CanonicalId;
  headsign: string;
  stops: TripStop[];
  shape?: Shape;
}

export interface Departure extends Provenance {
  lineId: CanonicalId;
  quayId?: CanonicalId;
  destination: string;
  scheduledAt: number;
  /** Présent seulement quand la source l'affirme en temps réel. */
  expectedAt?: number;
  platform?: string;
  cancelled: boolean;
  tripId?: string;
}

export interface DepartureGroup {
  destination: string;
  line: LineRef;
  departures: Departure[];
}

export interface JourneyLeg extends Provenance {
  kind: "walk" | "transit";
  from: TripStop;
  to: TripStop;
  departAt: number;
  arriveAt: number;
  /** Durée annoncée par la source, quand elle diffère de l'écart entre les heures. */
  durationSeconds?: number;
  line?: LineRef;
  headsign?: string;
  /** Les arrêts desservis, de la montée à la descente comprises. */
  intermediateStops?: TripStop[];
  stopCount?: number;
  /**
   * Identifiants propres à la source de la ligne et de l'arrêt de montée, pour
   * lui redemander les départs suivants. Ils n'ont de sens que pour elle.
   */
  boarding?: { lineId?: string; stopId?: string };
  shape?: Shape;
}

export interface Journey extends Provenance {
  /** Stable pour une même réponse ; déduit de l'heure de départ à défaut. */
  id?: string;
  legs: JourneyLeg[];
  departAt: number;
  arriveAt: number;
  transfers: number;
  durationSeconds?: number;
  /** Marche cumulée, accès et correspondances compris, quand la source la chiffre. */
  walkingSeconds?: number;
}

export interface Alert extends Provenance {
  scope: { lineIds?: CanonicalId[]; stationIds?: CanonicalId[] };
  title: string;
  /** Texte brut : tout HTML des opérateurs est retiré à la normalisation. */
  text: string;
  activePeriods: { start: number; end?: number }[];
}

/** Tuile géographique de découpage des requêtes d'arrêts (schéma XYZ). */
export interface GeoTile {
  z: number;
  x: number;
  y: number;
}

/**
 * Ce que l'interface sait d'une station quand elle demande ses départs : le
 * lieu touché sur la carte. Un adaptateur en tire ce que sa source attend —
 * IDFM résout sa zone d'arrêt par la position, le nom et la nature de l'arrêt
 * OSM ; Transitous interroge autour de la position.
 */
export interface StationRef {
  id: CanonicalId;
  name: string;
  lat: number;
  lon: number;
  /** Le lieu de la carte d'où vient la demande (identifiant et sous-classe OSM). */
  origin?: { placeId: string; rawType?: string };
}

export interface DepartureOptions {
  /** Nombre maximal de départs par ligne et destination. */
  perGroup?: number;
  /** Instant de référence, maintenant par défaut. */
  from?: number;
  /** Demande explicite de l'utilisateur : sauter le cache. */
  fresh?: boolean;
}

export interface JourneyOptions {
  at?: number;
  arriveBy?: boolean;
  maxResults?: number;
}

export interface AlertScope {
  lineIds?: CanonicalId[];
  stationIds?: CanonicalId[];
}
