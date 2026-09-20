import { CONFIG } from "../config";
import type { Place } from "../types";
import type { LineChip } from "../utils/markerImage";

// ---------------------------------------------------------------------------
// Lignes desservant les arrêts visibles, pour les dessiner sur la carte.
//
// Deux jeux de données ouvertes d'Île-de-France Mobilités, sans clé :
//
//  - le **référentiel des lignes**, dont on ne garde que les réseaux
//    concernés — métro, tramway, RER, Transilien, bus RATP — soit environ
//    300 lignes : 12 Ko une fois réduit au libellé et aux couleurs, gardés
//    dans `localStorage` puisqu'ils ne changent pratiquement jamais ;
//  - **les arrêts et leurs lignes**, interrogés par zone. L'export accepte un
//    filtre géographique et rend toute la zone en une seule requête, ce qui
//    évite de paginer à chaque déplacement de carte.
// ---------------------------------------------------------------------------

export interface StopLines {
  lon: number;
  lat: number;
  name: string;
  chips: LineChip[];
  /** Lignes au-delà des trois premières, pour l'indication « + N ». */
  extra: number;
  /** Toutes les lignes desservant l'arrêt, sans plafond. */
  all: LineChip[];
}

interface CompactLine {
  label: string;
  color: string;
  textColor: string;
  /** Rang d'affichage : le RER avant le métro, le métro avant le bus. */
  rank: number;
}

const MODE_RANK: Record<string, number> = { rail: 0, metro: 1, tram: 2, bus: 3 };

// --- Référentiel des lignes (libellés et couleurs) -------------------------

const LINE_INDEX_KEY = "osm-local:idfm-line-index";
const LINE_INDEX_TTL_MS = 30 * 24 * 3600 * 1000;

let lineIndex: Map<string, CompactLine> | null = readStoredIndex();
let lineIndexPromise: Promise<Map<string, CompactLine>> | null = null;

function readStoredIndex(): Map<string, CompactLine> | null {
  try {
    const raw = localStorage.getItem(LINE_INDEX_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { at: number; lines: [string, CompactLine][] };
    if (Date.now() - stored.at > LINE_INDEX_TTL_MS) return null;
    return new Map(stored.lines);
  } catch {
    return null;
  }
}

async function loadLineIndex(signal?: AbortSignal): Promise<Map<string, CompactLine>> {
  if (lineIndex) return lineIndex;
  if (lineIndexPromise) return lineIndexPromise;

  lineIndexPromise = (async () => {
    const url = new URL(CONFIG.IDFM_LINES_EXPORT_URL);
    url.searchParams.set("where", CONFIG.IDFM_NETWORK_FILTER);
    url.searchParams.set(
      "select",
      "id_line,shortname_line,transportmode,colourweb_hexa,textcolourweb_hexa"
    );

    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Référentiel des lignes indisponible (${res.status})`);
    const rows = (await res.json()) as {
      id_line?: string;
      shortname_line?: string;
      transportmode?: string;
      colourweb_hexa?: string | null;
      textcolourweb_hexa?: string | null;
    }[];

    const index = new Map<string, CompactLine>();
    for (const row of rows) {
      if (!row.id_line) continue;
      index.set(row.id_line, {
        label: row.shortname_line || row.id_line,
        color: `#${row.colourweb_hexa || "5856d6"}`,
        textColor: `#${row.textcolourweb_hexa || "ffffff"}`,
        rank: MODE_RANK[row.transportmode ?? ""] ?? 9,
      });
    }

    lineIndex = index;
    try {
      localStorage.setItem(LINE_INDEX_KEY, JSON.stringify({ at: Date.now(), lines: [...index] }));
    } catch {
      /* ignore : l'index sera simplement redemandé */
    }
    return index;
  })();

  try {
    return await lineIndexPromise;
  } finally {
    lineIndexPromise = null;
  }
}

// --- Arrêts et lignes d'une zone -------------------------------------------

interface StopRow {
  lon: number;
  lat: number;
  name: string;
  /** Mode du référentiel : `Bus`, `Metro`, `Tramway`, `RapidTransit`… */
  mode: string;
  lineIds: Set<string>;
}

// Une zone déjà interrogée n'est pas redemandée : se déplacer un peu ne doit
// pas relancer la requête à chaque image.
const areaCache = new Map<string, StopRow[]>();
const AREA_CACHE_LIMIT = 24;

/** Ce qu'une lecture du référentiel rapporte : le ferré seul, ou les bus seuls. */
type RowKind = "rail" | "bus";

function areaKey(lon: number, lat: number, radius: number, kind: RowKind): string {
  return `${lon.toFixed(3)},${lat.toFixed(3)},${Math.round(radius / 100)},${kind === "bus" ? "B" : "r"}`;
}

async function fetchStopRows(
  lon: number,
  lat: number,
  radius: number,
  kind: RowKind,
  signal?: AbortSignal
): Promise<StopRow[]> {
  const key = areaKey(lon, lat, radius, kind);
  const cached = areaCache.get(key);
  if (cached) return cached;

  const url = new URL(CONFIG.IDFM_STOP_LINES_URL);
  // Écarter les bus quand ils ne sont pas affichés change tout : ils font 85 %
  // du référentiel, et une zone de dix kilomètres passe ainsi de 1,6 Mo à
  // 200 Ko.
  const area = `within_distance(pointgeo, geom'POINT(${lon.toFixed(5)} ${lat.toFixed(5)})', ${Math.round(radius)}m)`;
  url.searchParams.set("where", kind === "bus" ? `${area} and mode = "Bus"` : `${area} and mode != "Bus"`);
  url.searchParams.set("select", "id,mode,stop_id,stop_name,stop_lon,stop_lat");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Arrêts et lignes indisponibles (${res.status})`);
  const rows = (await res.json()) as {
    id?: string;
    mode?: string;
    stop_id?: string;
    stop_name?: string;
    stop_lon?: string;
    stop_lat?: string;
  }[];

  // Un arrêt revient autant de fois qu'il a de lignes : on les réunit.
  const byStop = new Map<string, StopRow>();
  for (const row of rows) {
    if (!row.stop_id || !row.id) continue;
    const lonValue = Number(row.stop_lon);
    const latValue = Number(row.stop_lat);
    if (!Number.isFinite(lonValue) || !Number.isFinite(latValue)) continue;

    const existing = byStop.get(row.stop_id);
    // `IDFM:C01742` -> `C01742`, la clé du référentiel des lignes.
    const lineId = row.id.slice(row.id.indexOf(":") + 1);
    if (existing) existing.lineIds.add(lineId);
    else
      byStop.set(row.stop_id, {
        lon: lonValue,
        lat: latValue,
        name: row.stop_name ?? "",
        mode: row.mode ?? "",
        lineIds: new Set([lineId]),
      });
  }

  const result = [...byStop.values()];
  areaCache.set(key, result);
  if (areaCache.size > AREA_CACHE_LIMIT) areaCache.delete(areaCache.keys().next().value!);
  return result;
}

// --- Tracé d'une ligne -----------------------------------------------------

// Un tracé pèse de quelques kilo-octets pour un bus à près de six cents pour le
// RER B : on en garde peu, et seulement en mémoire.
const shapeCache = new Map<string, GeoJSON.Geometry | null>();
const SHAPE_CACHE_LIMIT = 8;

/**
 * Tracé d'une ligne, pour le dessiner sur la carte quand on la déplie.
 *
 * `null` si la ligne n'a pas de tracé publié — l'affichage s'en passe alors
 * sans rien signaler : c'est un complément, pas une information attendue.
 */
export async function getLineShape(lineId: string, signal?: AbortSignal): Promise<GeoJSON.Geometry | null> {
  const cached = shapeCache.get(lineId);
  if (cached !== undefined) return cached;

  const url = new URL(CONFIG.IDFM_LINE_SHAPES_URL);
  url.searchParams.set("where", `id_ilico="${lineId}"`);
  url.searchParams.set("select", "shape");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Tracé indisponible (${res.status})`);
  const data = (await res.json()) as { results?: { shape?: GeoJSON.Feature | GeoJSON.Geometry }[] };

  const shape = data.results?.[0]?.shape;
  // Le jeu de données rend une entité GeoJSON complète ; seule la géométrie
  // nous intéresse.
  const geometry =
    shape && "geometry" in shape ? (shape.geometry as GeoJSON.Geometry) : ((shape as GeoJSON.Geometry) ?? null);

  shapeCache.set(lineId, geometry ?? null);
  if (shapeCache.size > SHAPE_CACHE_LIMIT) shapeCache.delete(shapeCache.keys().next().value!);
  return geometry ?? null;
}

// --- Rattachement aux lieux de la carte ------------------------------------

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
  return Math.hypot(dLon * Math.cos(lat), dLat) * 6371000;
}

/** Rayon de rattachement : un quai peut être à quelques dizaines de mètres du
 *  point qu'OpenStreetMap place au milieu de la station. */
const MATCH_RADIUS_M = 90;
/**
 * Rayon élargi lorsque le nom correspond exactement.
 *
 * Une grande gare d'échange s'étale : à Châtelet, les quais du même nom sont
 * distants de plus de cent mètres. Le nom exact permet d'aller les chercher
 * sans risquer d'attraper l'arrêt d'à côté, qui, lui, porterait un autre nom.
 */
const EXACT_NAME_RADIUS_M = 250;

/**
 * Modes du référentiel acceptables selon la nature de l'arrêt cliqué.
 *
 * Sans ce filtre, une gare hériterait des bus qui la desservent : devant une
 * gare de banlieue, les poteaux « <nom de la gare> RER » sont à quelques dizaines
 * de mètres de la gare et portent presque le même nom. La gare doit annoncer son
 * RER, le poteau voisin ses bus — chacun ce qu'il dessert.
 */
const MODES_BY_FAMILY: Record<string, string[]> = {
  bus: ["Bus"],
  // Métro, tram et train partagent le même jeu : dans une gare d'échange, la
  // correspondance sur place fait partie de l'information utile.
  metro: ["Metro", "Tramway", "RapidTransit", "LocalTrain"],
  tram: ["Metro", "Tramway", "RapidTransit", "LocalTrain"],
  rail: ["Metro", "Tramway", "RapidTransit", "LocalTrain"],
};

/** Nature de l'arrêt d'après sa sous-classe OpenStreetMap. */
const FAMILY_BY_SUBCLASS: Record<string, string> = {
  bus_stop: "bus",
  bus_station: "bus",
  subway: "metro",
  subway_entrance: "metro",
  tram_stop: "tram",
  tram: "tram",
  station: "rail",
  halt: "rail",
  train_station_entrance: "rail",
};
/** Nombre de pastilles empilées avant l'indication « + N ». */
const MAX_CHIPS = 3;

/**
 * Lignes desservant chacun des arrêts donnés.
 *
 * Le rattachement se fait par proximité, en privilégiant les arrêts de même
 * nom : à moins de 90 mètres, une gare et le poteau de bus qui la dessert
 * portent deux noms distincts, et mélanger leurs lignes tromperait sur ce qui
 * passe où.
 */
export async function getLinesForStops(
  stops: Place[],
  center: { lon: number; lat: number },
  radius: number,
  includeBus: boolean,
  signal?: AbortSignal,
  /**
   * Pour un arrêt de bus : le poteau le plus proche (la carte, où l'on touche
   * un poteau précis), ou tous les poteaux de même nom alentour (la recherche,
   * où « Bourbaki » désigne l'arrêt entier — 107 d'un côté, 111 de l'autre).
   */
  busPoles: "nearest" | "sameName" = "nearest"
): Promise<Map<string, StopLines>> {
  const result = new Map<string, StopLines>();
  if (stops.length === 0) return result;

  // Le ferré sur tout le rayon, les bus sur un rayon plafonné : ils font 85 %
  // du référentiel, et depuis qu'ils s'affichent au zoom d'ouverture (14), une
  // vue de Paris en demandait 400 Ko d'un coup, contre 110 à 1,5 km. Un poteau
  // plus lointain garde son pictogramme jusqu'à ce qu'on s'en approche.
  const [index, rail, bus] = await Promise.all([
    loadLineIndex(signal),
    fetchStopRows(center.lon, center.lat, Math.min(radius, CONFIG.IDFM_STOP_LINES_MAX_RADIUS), "rail", signal),
    includeBus
      ? fetchStopRows(center.lon, center.lat, Math.min(radius, CONFIG.IDFM_BUS_LINES_MAX_RADIUS), "bus", signal)
      : Promise.resolve([] as StopRow[]),
  ]);
  const rows = [...rail, ...bus];

  for (const stop of stops) {
    const wanted = normalizeName(stop.name);
    const modes = MODES_BY_FAMILY[FAMILY_BY_SUBCLASS[stop.rawType ?? ""] ?? ""] ?? [];
    const candidates = rows
      .map((row) => ({ row, distance: distanceMeters(stop, row) }))
      .filter((entry) => entry.distance <= EXACT_NAME_RADIUS_M && modes.includes(entry.row.mode));
    const near = candidates.filter((entry) => entry.distance <= MATCH_RADIUS_M);

    // Un poteau de bus ne porte que ses propres lignes. Deux poteaux du même
    // nom appartiennent à une même zone d'arrêt sans y voir passer les mêmes
    // bus — à l'Hôtel de Ville, l'un dessert les 67, 72, 76, 96, N11 et N16,
    // l'autre le seul 69 — et réunir leurs lignes afficherait sur chacun des
    // lignes qui n'y passent pas. On s'en tient donc au plus proche, celui dont
    // on lit le nom sur le poteau.
    if (MODES_BY_FAMILY[FAMILY_BY_SUBCLASS[stop.rawType ?? ""] ?? ""] === MODES_BY_FAMILY.bus) {
      const nearest = near.sort((a, b) => a.distance - b.distance)[0];
      if (!nearest) continue;
      const sameName = busPoles === "sameName" ? near.filter((entry) => normalizeName(entry.row.name) === wanted) : [];
      addLines(stop, sameName.length ? sameName : [nearest], index, result);
      continue;
    }

    // Le nom exact d'abord : « <nom de la gare> » et « <nom de la gare> RER »
    // désignent deux arrêts distincts, et se contenter d'une
    // inclusion les confondrait.
    const exact = candidates.filter((entry) => normalizeName(entry.row.name) === wanted);
    const similar = near.filter((entry) => {
      const name = normalizeName(entry.row.name);
      return name.includes(wanted) || wanted.includes(name);
    });
    if (exact.length === 0 && near.length === 0) continue;
    // À défaut d'homonyme, on ne retient que l'arrêt le plus proche : réunir
    // tout ce qui passe à 90 mètres afficherait des lignes qui ne desservent
    // pas ce point.
    const matched =
      exact.length > 0 ? exact : similar.length > 0 ? similar : [near.sort((a, b) => a.distance - b.distance)[0]];

    addLines(stop, matched, index, result);
  }

  return result;
}

/** Réunit les lignes des arrêts retenus et en fait les pastilles du lieu. */
function addLines(
  stop: Place,
  matched: { row: StopRow }[],
  index: Map<string, CompactLine>,
  result: Map<string, StopLines>
) {
  const lineIds = new Set<string>();
  for (const entry of matched) for (const id of entry.row.lineIds) lineIds.add(id);

  const lines = [...lineIds]
    .map((id) => index.get(id))
    .filter((line): line is CompactLine => line !== undefined)
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "fr", { numeric: true }));
  if (lines.length === 0) return;

  const chips = lines.map(({ label, color, textColor }) => ({ label, color, textColor }));
  result.set(stop.id, {
    lon: stop.lon,
    lat: stop.lat,
    name: stop.name,
    chips: chips.slice(0, MAX_CHIPS),
    extra: Math.max(0, chips.length - MAX_CHIPS),
    all: chips,
  });
}

/**
 * Lignes desservant un arrêt, telles que le référentiel les déclare.
 *
 * La fiche s'en sert pour signaler celles dont le temps réel ne dit rien : à
 * Châtelet-Les Halles, le référentiel annonce les RER A, B et D, mais la source
 * ne diffuse par moments que le A et le B. Sans cette liste, le D disparaissait
 * de la fiche sans un mot.
 */
export async function getStopLines(place: Place, signal?: AbortSignal): Promise<LineChip[]> {
  const found = await getLinesForStops([place], { lon: place.lon, lat: place.lat }, 400, true, signal);
  return found.get(place.id)?.all ?? [];
}
