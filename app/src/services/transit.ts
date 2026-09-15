import { CONFIG } from "../config";
import { hasIdfmKey } from "./idfm";
import type { LonLat, RouteResult, RouteSegment } from "../types";
import { t } from "../i18n";

// ---------------------------------------------------------------------------
// Itinéraires en transports en commun.
//
// Le moteur est **Navitia**, exposé par la plateforme PRIM d'Île-de-France
// Mobilités : même clé que les prochains passages (`VITE_IDFM_API_KEY`), même
// en-tête `apiKey`, et l'origine croisée est autorisée — pas de proxy à
// prévoir. Contrairement à OSRM, qui ne connaît que la voirie, Navitia calcule
// sur les **horaires réels** : le trajet rendu part de l'heure demandée,
// enchaîne des passages effectivement programmés et compte le temps d'attente
// aux correspondances. `data_freshness=realtime` lui fait préférer, quand la
// ligne le diffuse, l'horaire du jour à l'horaire théorique.
//
// Deux conséquences à garder en tête :
//
//  - **Le quota est celui du temps réel** (1 000 appels par jour, tout confondu).
//    D'où la mise en cache ci-dessous et l'absence de tout recalcul
//    périodique : un itinéraire ne se rafraîchit qu'à la demande.
//  - **La couverture s'arrête à l'Île-de-France.** Hors de la région, Navitia
//    répond quand même — par un trajet à pied, faute de réseau connu. Ces
//    trajets sans transport sont écartés ici : le mode « À pied » existe déjà,
//    et une liste vide se dit clairement dans le panneau.
// ---------------------------------------------------------------------------

/** Nature d'une étape du trajet. */
export type TransitLegKind = "walk" | "transit";

/** Ligne empruntée, telle que l'annonce le référentiel (pastille officielle). */
export interface TransitLine {
  label: string;
  color: string;
  textColor: string;
  /** Mode commercial affiché par IDFM : « Métro », « RER », « Bus »… */
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
   * l'heure de passage. Navitia les envoie de toute façon dans la réponse ;
   * les garder ne coûte rien et permet de dire, en cours de route, combien
   * d'arrêts restent et lequel on vient de passer.
   */
  stops?: TransitStop[];
  /** Ligne et quai de montée, pour aller chercher les départs suivants. */
  lineId?: string;
  stopPointId?: string;
  /** Vrai quand l'horaire de l'étape tient compte du temps réel du jour. */
  realtime?: boolean;
  geometry?: GeoJSON.LineString;
}

export interface TransitJourney {
  id: string;
  departure: Date;
  arrival: Date;
  durationSeconds: number;
  transfers: number;
  /** Marche cumulée, temps d'accès et correspondances compris. */
  walkingSeconds: number;
  legs: TransitLeg[];
  /**
   * Indices des étapes après lesquelles on atteint un point de passage voulu,
   * quand le parcours en comporte (voir `getTransitJourneys`). C'est ce qui
   * distingue, dans le détail du trajet, une correspondance subie d'un arrêt
   * demandé — le panneau y intercale le nom de l'étape.
   */
  stopoverAfter?: number[];
}

// --- Réponse Navitia -------------------------------------------------------

interface NavitiaDisplayInformations {
  code?: string;
  label?: string;
  name?: string;
  color?: string;
  text_color?: string;
  direction?: string;
  headsign?: string;
  commercial_mode?: string;
  physical_mode?: string;
}

interface NavitiaStopTime {
  stop_point?: { id?: string; name?: string; label?: string; coord?: { lat?: string; lon?: string } };
  departure_date_time?: string;
  arrival_date_time?: string;
  data_freshness?: string;
}

interface NavitiaSection {
  type?: string;
  mode?: string;
  duration?: number;
  departure_date_time?: string;
  arrival_date_time?: string;
  data_freshness?: string;
  from?: { name?: string };
  to?: { name?: string };
  display_informations?: NavitiaDisplayInformations;
  links?: { id?: string; type?: string }[];
  stop_date_times?: NavitiaStopTime[];
  geojson?: GeoJSON.LineString;
}

interface NavitiaJourney {
  duration?: number;
  nb_transfers?: number;
  departure_date_time?: string;
  arrival_date_time?: string;
  durations?: { walking?: number };
  sections?: NavitiaSection[];
}

interface NavitiaResponse {
  journeys?: NavitiaJourney[];
  error?: { id?: string; message?: string };
}

/**
 * `20260901T182027` -> `Date`.
 *
 * Navitia rend l'heure **locale du réseau** (Europe/Paris), sans décalage :
 * elle est donc reconstruite comme une date locale, ce qui est juste pour un
 * appareil à l'heure française — le seul cas d'usage d'un réseau francilien.
 */
function parseNavitiaDate(value: string): Date {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(9, 11));
  const minute = Number(value.slice(11, 13));
  const second = Number(value.slice(13, 15));
  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * `Hôtel de Ville (Paris)` -> `Hôtel de Ville`.
 *
 * Navitia suffixe de la commune le nom des sections et des terminus. Dans le
 * détail d'un trajet, cette précision n'apprend rien — on sait dans quelle
 * ville on marche — et allonge chaque ligne au point de la faire déborder.
 * Les noms d'arrêt desservi (`stop_point.name`), eux, arrivent déjà nus.
 */
function stripCommune(name: string | undefined): string | undefined {
  return name?.replace(/\s*\([^()]*\)\s*$/, "").trim() || name;
}

/** `FFBE00` -> `#FFBE00` ; une couleur absente retombe sur le violet des lignes. */
function hexColor(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? "").replace("#", "").trim();
  return cleaned ? `#${cleaned}` : fallback;
}

function lineFromSection(info: NavitiaDisplayInformations | undefined): TransitLine {
  return {
    label: info?.code || info?.label || info?.name || "?",
    color: hexColor(info?.color, "#5856d6"),
    textColor: hexColor(info?.text_color, "#ffffff"),
    mode: info?.commercial_mode || info?.physical_mode || "",
  };
}

/** Sections de marche : accès, sortie et correspondances à pied. */
const WALK_SECTIONS = new Set(["street_network", "transfer", "crow_fly"]);
const TRANSIT_SECTIONS = new Set(["public_transport", "on_demand_transport"]);

function legFromSection(section: NavitiaSection): TransitLeg | null {
  const type = section.type ?? "";
  const kind: TransitLegKind | null = TRANSIT_SECTIONS.has(type)
    ? "transit"
    : WALK_SECTIONS.has(type)
      ? "walk"
      : null;
  // Les sections « waiting » ne sont pas des étapes : leur durée est déjà
  // comprise dans le total du trajet, et les afficher couperait en deux la
  // lecture d'une correspondance.
  if (!kind || !section.departure_date_time || !section.arrival_date_time) return null;
  // Une marche de quelques secondes entre deux quais n'apprend rien.
  if (kind === "walk" && (section.duration ?? 0) < 30) return null;

  // Les arrêts desservis, de la montée à la descente. Leur `name` est le nom nu
  // (« Hôtel de Ville ») là où celui de la section porte la commune entre
  // parenthèses : c'est le premier qu'on veut lire dans « Monter à… ».
  const stopTimes = section.stop_date_times ?? [];
  const served = stopTimes
    .map((stop) => stop.stop_point?.name)
    .filter((name): name is string => !!name);

  // Les arrêts avec leur position. Les coordonnées arrivent en chaînes dans la
  // réponse ; un arrêt qui n'en a pas est écarté plutôt que placé au large de
  // l'Afrique par un `Number("")` qui vaut zéro.
  const stops: TransitStop[] = stopTimes.flatMap((stop) => {
    const point = stop.stop_point;
    const lon = Number(point?.coord?.lon);
    const lat = Number(point?.coord?.lat);
    if (!point?.name || !Number.isFinite(lon) || !Number.isFinite(lat) || (!lon && !lat)) return [];
    const at = stop.arrival_date_time ?? stop.departure_date_time;
    return [{ name: point.name, lon, lat, at: at ? parseNavitiaDate(at) : new Date(0) }];
  });

  return {
    kind,
    departure: parseNavitiaDate(section.departure_date_time),
    arrival: parseNavitiaDate(section.arrival_date_time),
    durationSeconds: section.duration ?? 0,
    from: served[0] ?? stripCommune(section.from?.name),
    to: served[served.length - 1] ?? stripCommune(section.to?.name),
    line: kind === "transit" ? lineFromSection(section.display_informations) : undefined,
    direction:
      stripCommune(section.display_informations?.direction) || section.display_informations?.headsign,
    stopCount: kind === "transit" && served.length > 1 ? served.length - 1 : undefined,
    stops: stops.length ? stops : undefined,
    lineId: section.links?.find((link) => link.type === "line")?.id,
    stopPointId: stopTimes[0]?.stop_point?.id,
    realtime: section.data_freshness === "realtime",
    geometry: section.geojson?.coordinates?.length ? section.geojson : undefined,
  };
}

function journeyFromNavitia(journey: NavitiaJourney, index: number): TransitJourney | null {
  if (!journey.departure_date_time || !journey.arrival_date_time) return null;
  const legs = (journey.sections ?? []).map(legFromSection).filter((leg): leg is TransitLeg => leg !== null);
  // Un trajet sans transport est un trajet à pied : le mode « À pied » le fait
  // déjà, et mieux (profil piéton d'OSRM).
  if (!legs.some((leg) => leg.kind === "transit")) return null;

  return {
    id: `${journey.departure_date_time}-${index}`,
    departure: parseNavitiaDate(journey.departure_date_time),
    arrival: parseNavitiaDate(journey.arrival_date_time),
    durationSeconds: journey.duration ?? 0,
    transfers: journey.nb_transfers ?? 0,
    walkingSeconds: journey.durations?.walking ?? 0,
    legs,
  };
}

// --- Cache -----------------------------------------------------------------

// Le même couple départ/arrivée est redemandé à chaque va-et-vient dans le
// panneau (changement de mode, retour sur « transports »). Sans ce cache, une
// poignée d'allers-retours suffirait à entamer le quota du jour.
interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<TransitJourney[]>>();

// L'heure de départ fait partie de la clé : dans un parcours à étapes, chaque
// tronçon part de l'arrivée du précédent, et deux calculs lancés à des heures
// différentes n'ont pas la même réponse. Elle est arrondie à la minute — la
// résolution des horaires, et celle du cache lui-même (TTL d'une minute).
function cacheKey(from: LonLat, to: LonLat, at: Date | undefined): string {
  const round = (value: number) => value.toFixed(5);
  const when = at ? toNavitiaDate(at).slice(0, 13) : "now";
  return `${round(from.lon)},${round(from.lat)}>${round(to.lon)},${round(to.lat)}@${when}`;
}

// --- Requête ---------------------------------------------------------------

/** Message d'erreur lisible pour les identifiants d'erreur de Navitia. */
function messageForError(id: string | undefined): string {
  switch (id) {
    case "no_origin":
    case "no_destination":
    case "no_origin_nor_destination":
      return t("error.transitOutside");
    case "no_solution":
      return t("error.transitNoSolution");
    default:
      return t("error.transitUnavailable");
  }
}

/**
 * Un tronçon de parcours : les trajets proposés entre deux points, au départ
 * de `at` (l'heure du calcul si elle est omise).
 *
 * Rend une liste ordonnée par heure d'arrivée, la plus rapide en tête. Une
 * liste vide signifie « aucun trajet en transports ici » (hors Île-de-France,
 * le plus souvent) : ce n'est pas une panne, et le panneau le dit autrement
 * qu'une erreur.
 */
async function journeysBetween(
  from: LonLat,
  to: LonLat,
  at: Date | undefined,
  signal?: AbortSignal
): Promise<TransitJourney[]> {
  const key = cacheKey(from, to, at);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CONFIG.IDFM_JOURNEYS_TTL_MS) return cached.value;

  const url = new URL(`${CONFIG.IDFM_NAVITIA_URL}/journeys`);
  url.searchParams.set("from", `${from.lon};${from.lat}`);
  url.searchParams.set("to", `${to.lon};${to.lat}`);
  // Sans `datetime`, Navitia part de maintenant — ce qu'on veut du premier
  // tronçon. Les suivants partent de l'arrivée du précédent.
  if (at) url.searchParams.set("datetime", toNavitiaDate(at));
  url.searchParams.set("datetime_represents", "departure");
  // Horaires du jour quand la ligne les diffuse, théoriques sinon.
  url.searchParams.set("data_freshness", "realtime");
  url.searchParams.set("max_nb_journeys", String(CONFIG.IDFM_MAX_JOURNEYS));

  const res = await fetch(url, { headers: { apiKey: CONFIG.IDFM_API_KEY }, signal });
  if (res.status === 401 || res.status === 403) {
    throw new Error(t("error.transitRefused"));
  }
  if (res.status === 429) {
    throw new Error(t("error.transitQuota"));
  }
  if (!res.ok) throw new Error(t("error.transitFailed", { status: res.status }));

  const data: NavitiaResponse = await res.json();
  if (!data.journeys) throw new Error(messageForError(data.error?.id));

  const journeys = data.journeys
    .map(journeyFromNavitia)
    .filter((journey): journey is TransitJourney => journey !== null)
    .sort((a, b) => a.arrival.getTime() - b.arrival.getTime())
    .slice(0, CONFIG.TRANSIT_MAX_RESULTS);

  cache.set(key, { at: Date.now(), value: journeys });
  return journeys;
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
function stitchJourneys(parts: TransitJourney[]): TransitJourney {
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
    departure,
    arrival,
    durationSeconds: Math.round((arrival.getTime() - departure.getTime()) / 1000),
    transfers: parts.reduce((total, part) => total + part.transfers, 0),
    walkingSeconds: parts.reduce((total, part) => total + part.walkingSeconds, 0),
    legs,
    stopoverAfter,
  };
}

/**
 * Trajets en transports en commun le long d'un parcours, au départ de
 * maintenant. `points` va du départ à l'arrivée, étapes comprises.
 *
 * **Sans étape**, c'est un appel et une liste de propositions parmi lesquelles
 * choisir. **Avec étapes**, c'est un appel par tronçon : Navitia ne sait pas
 * router par des points de passage, il faut donc enchaîner — chaque tronçon
 * part de l'arrivée du précédent, et le meilleur de chacun (le premier, la
 * liste étant triée) est retenu. Le résultat est alors **un seul trajet** et
 * non un choix : comparer les combinaisons de trois propositions sur cinq
 * tronçons n'aurait ni sens à lire ni un coût d'appels tenable.
 *
 * C'est ce coût qui justifie le plafond `CONFIG.MAX_WAYPOINTS` : le quota est
 * de 1 000 appels par jour, partagé avec les prochains passages.
 *
 * Un tronçon sans solution rend une liste vide pour le parcours entier — il
 * n'y a pas de demi-trajet à proposer.
 */
export async function getTransitJourneys(
  points: LonLat[],
  signal?: AbortSignal
): Promise<TransitJourney[]> {
  if (!hasIdfmKey()) {
    throw new Error(t("error.transitNoKey"));
  }
  if (points.length < 2) return [];
  if (points.length === 2) return journeysBetween(points[0], points[1], undefined, signal);

  const parts: TransitJourney[] = [];
  // Le premier tronçon part de maintenant (`undefined`), les suivants de
  // l'arrivée du précédent. La boucle est **séquentielle par nécessité** : on
  // ne peut pas demander le tronçon suivant avant de savoir à quelle heure on
  // arrive au point de passage.
  let at: Date | undefined;
  for (let index = 0; index < points.length - 1; index++) {
    const leg = await journeysBetween(points[index], points[index + 1], at, signal);
    if (!leg.length) return [];
    parts.push(leg[0]);
    at = leg[0].arrival;
  }
  return [stitchJourneys(parts)];
}

// --- Départs suivants à l'arrêt de montée --------------------------------

/** Un passage ultérieur de la même ligne, au même quai. */
export interface NextDeparture {
  at: Date;
  /** Vrai quand l'horaire est celui du jour, et non l'horaire théorique. */
  realtime: boolean;
}

interface NavitiaDeparturesResponse {
  departures?: {
    stop_date_time?: { departure_date_time?: string; data_freshness?: string };
  }[];
  error?: { id?: string };
}

/** `Date` -> `20260901T182027`, le format que Navitia attend en paramètre. */
function toNavitiaDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

const departuresCache = new Map<string, CacheEntry<NextDeparture[]>>();

/**
 * Les passages suivants de la même ligne, au quai où l'on monte.
 *
 * C'est la question qu'on se pose une fois le trajet choisi : « et si je rate
 * celui-là ? ». Le quai (`stop_point`) porte déjà le sens de circulation — sur
 * un quai de métro comme à un poteau de bus, tout ce qui passe va du même
 * côté — il n'y a donc pas à filtrer par direction.
 *
 * Appelé **au dépli seulement** : c'est un appel de plus sur le quota commun
 * aux prochains passages (1 000 par jour), et sa réponse est mise en cache.
 */
export async function getNextDepartures(
  lineId: string,
  stopPointId: string,
  after: Date,
  signal?: AbortSignal
): Promise<NextDeparture[]> {
  if (!hasIdfmKey()) throw new Error("Clé Île-de-France Mobilités absente.");

  const key = `${lineId}|${stopPointId}|${toNavitiaDate(after)}`;
  const cached = departuresCache.get(key);
  if (cached && Date.now() - cached.at < CONFIG.IDFM_JOURNEYS_TTL_MS) return cached.value;

  // Une seconde après le départ qu'on prend : la liste commence donc au
  // passage d'après, et non par celui qu'on a déjà sous les yeux.
  const from = new Date(after.getTime() + 1000);
  const url = new URL(
    `${CONFIG.IDFM_NAVITIA_URL}/lines/${encodeURIComponent(lineId)}` +
      `/stop_points/${encodeURIComponent(stopPointId)}/departures`
  );
  url.searchParams.set("from_datetime", toNavitiaDate(from));
  url.searchParams.set("count", String(CONFIG.IDFM_NEXT_DEPARTURES));
  url.searchParams.set("data_freshness", "realtime");

  const res = await fetch(url, { headers: { apiKey: CONFIG.IDFM_API_KEY }, signal });
  if (!res.ok) throw new Error(`Horaires suivants indisponibles (${res.status})`);

  const data: NavitiaDeparturesResponse = await res.json();
  const departures = (data.departures ?? [])
    .map((departure) => {
      const time = departure.stop_date_time?.departure_date_time;
      return time
        ? { at: parseNavitiaDate(time), realtime: departure.stop_date_time?.data_freshness === "realtime" }
        : null;
    })
    .filter((departure): departure is NextDeparture => departure !== null && departure.at > after);

  departuresCache.set(key, { at: Date.now(), value: departures });
  return departures;
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
