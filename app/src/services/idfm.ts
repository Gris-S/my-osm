import { CONFIG } from "../config";
import type { Place } from "../types";
import { t } from "../i18n";

// ---------------------------------------------------------------------------
// Prochains passages des transports franciliens.
//
// Deux sources, toutes deux appelées directement depuis le navigateur (les
// deux autorisent explicitement les requêtes d'origine croisée) :
//
//  - **PRIM** (Île-de-France Mobilités) pour le temps réel, au format SIRI Lite
//    `stop-monitoring`. Demande une clé personnelle et gratuite, passée dans
//    l'en-tête `apiKey` ; quota courant : 1 000 appels par jour, ce qui exclut
//    tout rafraîchissement automatique — d'où la mise en cache par arrêt.
//  - le **référentiel ouvert** d'Île-de-France Mobilités, sans clé, pour deux
//    choses : retrouver la zone d'arrêt qui correspond au lieu cliqué, et
//    traduire un identifiant SIRI (`STIF:Line::C01742:`) en « RER A » avec son
//    mode et sa couleur officielle. Les deux sont mis en cache durablement :
//    ni les arrêts ni les lignes ne bougent d'un jour à l'autre.
//
// Le rattachement d'un arrêt OSM à l'identifiant régional **ne passe pas par le
// tag `ref:FR:STIF`** : vérification faite sur le terrain, ce tag porte un
// identifiant de *point* d'arrêt (un quai), pas de *zone* d'arrêt, et il est
// parfois absent ou périmé — à la gare du Musée d'Orsay, il ne rend aucun
// passage. On interroge donc le référentiel officiel par proximité et par nom,
// ce qui donne la zone d'arrêt, seule à réunir les deux sens de circulation.
// ---------------------------------------------------------------------------

export type TransitMode = "bus" | "metro" | "tram" | "rer" | "train" | "other";

export interface Departure {
  /** Heure de passage attendue. */
  at: Date;
  /** Minutes restantes, négatives si le passage vient d'avoir lieu. */
  minutes: number;
  destination: string;
  /** Quai ou voie, quand la source le donne. */
  platform?: string;
  cancelled: boolean;
  /** Heure attendue (temps réel) plutôt que planifiée : la source l'a annoncée ainsi. */
  realtime: boolean;
}

/** Les passages vers une même destination. */
export interface DepartureGroup {
  key: string;
  label: string;
  departures: Departure[];
}

export interface LineDepartures {
  lineId: string;
  label: string;
  mode: TransitMode;
  color: string;
  textColor: string;
  network?: string;
  groups: DepartureGroup[];
}

/** Horizon au-delà duquel un passage n'est plus « prochain », en minutes. */
const MAX_HORIZON_MIN = 120;

export function hasIdfmKey(): boolean {
  return CONFIG.IDFM_API_KEY.trim().length > 0;
}

// --- Référentiel des lignes ------------------------------------------------

interface LineInfo {
  label: string;
  mode: TransitMode;
  color: string;
  textColor: string;
  network?: string;
}

const LINE_STORAGE_KEY = "osm-local:idfm-lines";
const lineCache = new Map<string, LineInfo>(readStoredLines());

function readStoredLines(): [string, LineInfo][] {
  try {
    const raw = localStorage.getItem(LINE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as [string, LineInfo][]) : [];
  } catch {
    return [];
  }
}

function persistLines() {
  try {
    localStorage.setItem(LINE_STORAGE_KEY, JSON.stringify([...lineCache]));
  } catch {
    /* ignore : le référentiel sera simplement redemandé */
  }
}

/**
 * Mode de transport à partir du couple mode/sous-mode du référentiel.
 * Le « rail » couvre aussi bien le RER (`local`) que le Transilien
 * (`suburbanRailway`) ou le TER (`regionalRail`), qui ne s'affichent pas de la
 * même façon.
 */
function modeFromReferential(mode: string, submode: string | null): TransitMode {
  if (mode === "bus") return "bus";
  if (mode === "metro") return "metro";
  if (mode === "tram") return "tram";
  if (mode === "rail") return submode === "local" ? "rer" : "train";
  return "other";
}

/** `STIF:Line::C01742:` -> `C01742`. */
function lineIdFromRef(lineRef: string): string {
  const withoutTail = lineRef.endsWith(":") ? lineRef.slice(0, -1) : lineRef;
  return withoutTail.slice(withoutTail.lastIndexOf(":") + 1);
}

async function fetchLineInfo(lineId: string, signal?: AbortSignal): Promise<LineInfo> {
  const cached = lineCache.get(lineId);
  if (cached) return cached;

  const fallback: LineInfo = { label: lineId, mode: "other", color: "#5856D6", textColor: "#ffffff" };
  try {
    const url = new URL(CONFIG.IDFM_LINES_URL);
    url.searchParams.set("where", `id_line="${lineId}"`);
    url.searchParams.set("limit", "1");
    const res = await fetch(url, { signal });
    if (!res.ok) return fallback;

    const data = (await res.json()) as {
      results?: {
        shortname_line?: string;
        name_line?: string;
        transportmode?: string;
        transportsubmode?: string | null;
        networkname?: string | null;
        colourweb_hexa?: string | null;
        textcolourweb_hexa?: string | null;
      }[];
    };
    const row = data.results?.[0];
    if (!row) return fallback;

    const info: LineInfo = {
      label: row.shortname_line || row.name_line || lineId,
      mode: modeFromReferential(row.transportmode ?? "", row.transportsubmode ?? null),
      color: `#${row.colourweb_hexa || "5856d6"}`,
      textColor: `#${row.textcolourweb_hexa || "ffffff"}`,
      network: row.networkname ?? undefined,
    };
    lineCache.set(lineId, info);
    persistLines();
    return info;
  } catch {
    return fallback;
  }
}

// --- Réponse SIRI ----------------------------------------------------------

/** Les champs textuels de SIRI arrivent en tableaux d'objets `{ value }`. */
type SiriText = { value?: string }[] | undefined;

interface MonitoredStopVisit {
  MonitoringRef?: { value?: string };
  MonitoredVehicleJourney?: {
    LineRef?: { value?: string };
    DirectionName?: SiriText;
    DirectionRef?: { value?: string };
    DestinationName?: SiriText;
    DestinationShortName?: SiriText;
    DestinationRef?: { value?: string };
    MonitoredCall?: {
      ExpectedDepartureTime?: string;
      ExpectedArrivalTime?: string;
      AimedDepartureTime?: string;
      AimedArrivalTime?: string;
      DepartureStatus?: string;
      ArrivalStatus?: string;
      DeparturePlatformName?: { value?: string };
      ArrivalPlatformName?: { value?: string };
    };
  };
}

interface SiriResponse {
  Siri?: {
    ServiceDelivery?: {
      StopMonitoringDelivery?: { MonitoredStopVisit?: MonitoredStopVisit[] }[];
    };
  };
}

function firstText(field: SiriText): string | undefined {
  const value = field?.[0]?.value?.trim();
  return value || undefined;
}

// --- Résolution de l'arrêt -------------------------------------------------

/** Sous-classes OSM qui désignent un arrêt desservi, et leur famille IDFM. */
const TRANSIT_FAMILIES: Record<string, "bus" | "rail"> = {
  bus_stop: "bus",
  bus_station: "bus",
  subway: "rail",
  subway_entrance: "rail",
  tram_stop: "rail",
  tram: "rail",
  station: "rail",
  halt: "rail",
  train_station_entrance: "rail",
};

/** Types du référentiel acceptables pour chaque famille. */
const REFERENTIAL_TYPES: Record<"bus" | "rail", string[]> = {
  bus: ["bus"],
  rail: ["metro", "rail", "tram"],
};

/** Vrai si le lieu est un arrêt dont on peut annoncer les prochains passages. */
export function isTransitStop(place: Place): boolean {
  return place.group === "transport" && TRANSIT_FAMILIES[place.rawType ?? ""] !== undefined;
}

/** Comparaison de noms indifférente aux accents, tirets et majuscules. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distanceMeters(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat = ((a.lat + b.lat) / 2) * toRad;
  const x = dLon * Math.cos(lat);
  return Math.hypot(x, dLat) * 6371000;
}

interface StopCandidate {
  arrid: string;
  zdaid: string;
  name: string;
  type: string;
  distance: number;
}

// La clé porte le format des valeurs. Elle a changé le jour où l'on est passé
// d'identifiants de zone bruts à des références SIRI complètes : sans cela, un
// navigateur qui avait déjà consulté un arrêt continuait de servir l'ancien
// format, que l'API rejette — la station n'affichait alors plus aucun passage.
const AREA_STORAGE_KEY = "osm-local:idfm-refs";
const areaCache = new Map<string, string[]>(readStoredAreas());

function readStoredAreas(): [string, string[]][] {
  try {
    const raw = localStorage.getItem(AREA_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as [string, string[]][]) : [];
    // Ceinture et bretelles : on ne garde que ce qui ressemble à une référence.
    return stored.filter(
      ([, refs]) => Array.isArray(refs) && refs.every((ref) => typeof ref === "string" && ref.startsWith("STIF:"))
    );
  } catch {
    return [];
  }
}

function persistAreas() {
  try {
    localStorage.setItem(AREA_STORAGE_KEY, JSON.stringify([...areaCache]));
  } catch {
    /* ignore : la résolution sera simplement refaite */
  }
}

/**
 * Références SIRI à interroger pour le lieu cliqué, la plus probable en tête.
 *
 * La granularité n'est pas la même selon le mode, et c'est tout l'enjeu :
 *
 *  - un **poteau de bus** se désigne par son *point* d'arrêt. Deux poteaux du
 *    même nom appartiennent à une même zone, mais n'y voient pas passer les
 *    mêmes lignes : à l'Hôtel de Ville, l'un dessert les 67, 72, 76, 96, N11 et
 *    N16, l'autre le seul 69. Interroger la zone rendait les cinq mélangées,
 *    sans rapport avec les pastilles affichées sur le point cliqué ;
 *  - une **gare ou station** se désigne au contraire par sa *zone* d'arrêt,
 *    seule à réunir les deux sens de circulation.
 *
 * Une seconde zone est ajoutée lorsqu'elle porte le même nom dans un autre
 * mode : à Denfert-Rochereau, la station de métro et la gare du RER sont deux
 * zones distinctes, et n'en montrer qu'une cacherait la moitié des passages.
 */
async function resolveMonitoringRefs(place: Place, signal?: AbortSignal): Promise<string[]> {
  const cached = areaCache.get(place.id);
  if (cached) return cached;

  const family = TRANSIT_FAMILIES[place.rawType ?? ""] ?? "rail";
  const url = new URL(CONFIG.IDFM_STOPS_URL);
  url.searchParams.set(
    "where",
    `within_distance(arrgeopoint, geom'POINT(${place.lon.toFixed(6)} ${place.lat.toFixed(6)})', 200m)`
  );
  url.searchParams.set("select", "arrid,arrname,arrtype,zdaid,arrgeopoint");
  url.searchParams.set("limit", "50");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Référentiel des arrêts indisponible (${res.status})`);
  const data = (await res.json()) as {
    results?: {
      arrid?: string;
      arrname?: string;
      arrtype?: string;
      zdaid?: string;
      arrgeopoint?: { lon: number; lat: number };
    }[];
  };

  const accepted = REFERENTIAL_TYPES[family];
  const candidates: StopCandidate[] = [];
  for (const row of data.results ?? []) {
    if (!row.arrid || !row.zdaid || !row.arrgeopoint) continue;
    if (!accepted.includes(row.arrtype ?? "")) continue;
    candidates.push({
      arrid: row.arrid,
      zdaid: row.zdaid,
      name: row.arrname ?? "",
      type: row.arrtype ?? "",
      distance: distanceMeters(place, row.arrgeopoint),
    });
  }
  if (candidates.length === 0) return [];

  if (family === "bus") {
    // Le poteau le plus proche, et lui seul : c'est ce qui est écrit dessus.
    const nearest = candidates.reduce((best, one) => (one.distance < best.distance ? one : best));
    const refs = [`STIF:StopPoint:Q:${nearest.arrid}:`];
    areaCache.set(place.id, refs);
    persistAreas();
    return refs;
  }

  // Une zone d'arrêt compte plusieurs quais : on ne la retient qu'une fois, au
  // plus proche.
  const byArea = new Map<string, StopCandidate>();
  for (const candidate of candidates) {
    const known = byArea.get(candidate.zdaid);
    if (!known || candidate.distance < known.distance) byArea.set(candidate.zdaid, candidate);
  }

  const wantedName = normalizeName(place.name);
  const score = (candidate: StopCandidate): number => {
    const name = normalizeName(candidate.name);
    let value = -candidate.distance / 100;
    if (name === wantedName) value += 4;
    else if (name.includes(wantedName) || wantedName.includes(name)) value += 2;
    return value;
  };

  const ranked = [...byArea.values()].sort((a, b) => score(b) - score(a));
  const best = ranked[0];
  const refs = [`STIF:StopArea:SP:${best.zdaid}:`];
  const sibling = ranked
    .slice(1)
    .find((candidate) => normalizeName(candidate.name) === normalizeName(best.name) && candidate.type !== best.type);
  if (sibling) refs.push(`STIF:StopArea:SP:${sibling.zdaid}:`);

  areaCache.set(place.id, refs);
  persistAreas();
  return refs;
}

// --- Interrogation ---------------------------------------------------------

async function fetchVisits(monitoringRef: string, signal?: AbortSignal): Promise<MonitoredStopVisit[]> {
  const url = new URL(CONFIG.IDFM_STOP_MONITORING_URL);
  url.searchParams.set("MonitoringRef", monitoringRef);

  const res = await fetch(url, { headers: { apiKey: CONFIG.IDFM_API_KEY }, signal });
  if (!res.ok) throw new Error(`Passages indisponibles (${res.status})`);

  const data = (await res.json()) as SiriResponse;
  return data.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit ?? [];
}

interface RawDeparture {
  lineId: string;
  destination: string;
  departure: Departure;
}

/** Comparaison de noms indifférente aux accents, tirets et majuscules. */
function sameName(a: string, b: string): boolean {
  const clean = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return clean(a) === clean(b);
}

function toRawDeparture(visit: MonitoredStopVisit, stopName: string, now: number): RawDeparture | null {
  const journey = visit.MonitoredVehicleJourney;
  const call = journey?.MonitoredCall;
  const lineRef = journey?.LineRef?.value;
  if (!journey || !call || !lineRef) return null;

  const time = call.ExpectedDepartureTime ?? call.ExpectedArrivalTime ?? call.AimedDepartureTime ?? call.AimedArrivalTime;
  if (!time) return null;
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) return null;

  const minutes = Math.round((at.getTime() - now) / 60000);
  // Un passage déjà parti depuis plus d'une minute n'intéresse plus personne ;
  // on garde la minute écoulée, le temps que « à quai » reste visible.
  if (minutes < -1) return null;
  // Au-delà de deux heures, ce ne sont plus des « prochains passages ».
  if (minutes > MAX_HORIZON_MIN) return null;

  const destination =
    firstText(journey.DestinationName) ?? firstText(journey.DestinationShortName) ?? "Destination inconnue";

  // Un train qui termine ici ne mène nulle part : l'annoncer comme destination
  // ferait un encart « Vers Denfert-Rochereau » … à Denfert-Rochereau.
  if (sameName(destination, stopName)) return null;
  if (journey.DestinationRef?.value && journey.DestinationRef.value === visit.MonitoringRef?.value) return null;

  const status = (call.DepartureStatus ?? call.ArrivalStatus ?? "").toLowerCase();

  return {
    lineId: lineIdFromRef(lineRef),
    destination,
    departure: {
      at,
      minutes,
      destination,
      platform: call.DeparturePlatformName?.value ?? call.ArrivalPlatformName?.value ?? undefined,
      cancelled: status === "cancelled",
      realtime: Boolean(call.ExpectedDepartureTime ?? call.ExpectedArrivalTime),
    },
  };
}

/**
 * Regroupe les passages d'une ligne par terminus.
 *
 * Le sens de circulation aurait fait des encarts plus compacts pour le RER,
 * mais la source ne le donne pas de façon fiable : à Châtelet-Les Halles, une
 * partie des trains du RER A arrive avec un `DirectionRef` vide, si bien qu'un
 * même encart réunissait La Défense, Marne-la-Vallée et Saint-Germain-en-Laye —
 * deux directions opposées sous une seule étiquette. Le terminus, lui, est
 * toujours renseigné et dit sans ambiguïté où va le train.
 */
function groupDepartures(raw: RawDeparture[]): DepartureGroup[] {
  const buckets = new Map<string, RawDeparture[]>();
  for (const entry of raw) {
    const bucket = buckets.get(entry.destination);
    if (bucket) bucket.push(entry);
    else buckets.set(entry.destination, [entry]);
  }

  const groups = [...buckets].map(([destination, entries]) => ({
    key: destination,
    label: t("departures.towards", { destination }),
    departures: entries.map((entry) => entry.departure).sort((a, b) => a.at.getTime() - b.at.getTime()),
  }));

  // Le plus imminent d'abord : c'est le train qu'on regarde en arrivant.
  groups.sort((a, b) => (a.departures[0]?.at.getTime() ?? 0) - (b.departures[0]?.at.getTime() ?? 0));
  return groups;
}

// Une réponse vaut pour quelques dizaines de secondes : rouvrir une fiche ne
// doit pas consommer le quota, déjà modeste.
const departuresCache = new Map<string, { at: number; lines: LineDepartures[] }>();

/**
 * Prochains passages au lieu donné, une entrée par ligne.
 *
 * Lève si aucune source ne répond ; rend un tableau vide quand l'arrêt est
 * connu mais qu'aucun passage n'est annoncé — service terminé, par exemple, ou
 * arrêt dont le temps réel n'est pas encore publié : Île-de-France Mobilités ne
 * couvre pas encore tout le réseau.
 */
export async function getDepartures(
  place: Place,
  signal?: AbortSignal,
  options: { fresh?: boolean } = {}
): Promise<LineDepartures[]> {
  if (!hasIdfmKey()) throw new Error("Clé PRIM absente");

  const areas = await resolveMonitoringRefs(place, signal);
  if (areas.length === 0) return [];

  const cacheKey = areas.join("+");
  const cached = departuresCache.get(cacheKey);
  // `fresh` saute le cache : c'est une demande explicite de l'utilisateur (un
  // nouveau contact sur l'arrêt déjà ouvert), jamais un rafraîchissement
  // automatique — le quota l'interdit.
  if (cached && !options.fresh && Date.now() - cached.at < CONFIG.IDFM_DEPARTURES_TTL_MS) return cached.lines;

  const visits: MonitoredStopVisit[] = [];
  let lastError: unknown = null;
  for (const area of areas) {
    try {
      visits.push(...(await fetchVisits(area, signal)));
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  if (visits.length === 0 && lastError) throw lastError;

  const now = Date.now();
  const byLine = new Map<string, RawDeparture[]>();
  for (const visit of visits) {
    const raw = toRawDeparture(visit, place.name, now);
    if (!raw) continue;
    const entries = byLine.get(raw.lineId);
    if (entries) entries.push(raw);
    else byLine.set(raw.lineId, [raw]);
  }

  const lines = await Promise.all(
    [...byLine].map(async ([lineId, entries]): Promise<LineDepartures> => {
      const info = await fetchLineInfo(lineId, signal);
      return {
        lineId,
        label: info.label,
        mode: info.mode,
        color: info.color,
        textColor: info.textColor,
        network: info.network,
        groups: groupDepartures(entries),
      };
    })
  );

  // Métro et RER d'abord, puis tramway, puis bus : l'ordre dans lequel on les
  // cherche des yeux sur un plan de quai.
  const order: TransitMode[] = ["metro", "rer", "train", "tram", "bus", "other"];
  lines.sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode) || a.label.localeCompare(b.label, "fr", { numeric: true }));

  departuresCache.set(cacheKey, { at: Date.now(), lines });
  return lines;
}
