import { CONFIG } from "../config";
import type { LonLat } from "../types";
import { decodePolyline } from "../transport/polyline";

// ---------------------------------------------------------------------------
// L'itinéraire à vélo : Valhalla d'abord, BRouter en secours.
//
// Les deux réponses sont ramenées à **la forme d'OSRM avec `steps=true`** —
// celle que le guidage à pied lit déjà (`navigation/route.ts`). Valhalla la
// produit lui-même (`format: "osrm"`) ; celle de BRouter est traduite ici.
//
// **Le secours est silencieux** (décision de l'utilisateur, 29 septembre 2026 :
// « tu le gardes mais tu le dis pas ») : ni avertissement ni réglage. Il ne se
// voit que dans la console.
//
// Deux profils fixes, sans réglage (même décision) : `fast`, le plus rapide, et
// `safe`, le moins de circulation possible. Ils sont proposés côte à côte au
// départ d'une navigation, comme les itinéraires voiture.
//
// Pourquoi ces deux moteurs, et pas l'OSRM vélo de la FOSSGIS : voir
// `CONFIG.BIKE_ROUTING`.
// ---------------------------------------------------------------------------

/** Le moteur qui a répondu. `brouter` ne sert qu'en secours. */
export type BikeSource = "valhalla" | "brouter";

/** Le plus rapide, ou le plus sûr. */
export type BikeProfile = "fast" | "safe";

/** Une étape, sous la forme d'OSRM (`steps=true`, `geometries=geojson`). */
export interface OsrmLikeStep {
  distance: number;
  duration: number;
  name: string;
  geometry: GeoJSON.LineString;
  maneuver: {
    type: string;
    modifier?: string;
    exit?: number;
    location: [number, number];
  };
}

export interface OsrmLikeRoute {
  distance: number;
  duration: number;
  geometry: GeoJSON.LineString;
  legs: Array<{ steps: OsrmLikeStep[] }>;
}

export interface BikeRoute {
  source: BikeSource;
  route: OsrmLikeRoute;
}

/**
 * Pourquoi un calcul a échoué, pour que chaque appelant le dise dans ses mots :
 * - `offline` : pas de réseau, ou aucun moteur joignable ;
 * - `noRoute` : le moteur a répondu, et il n'y a pas de chemin (ou trop long) ;
 * - `service` : le moteur a répondu une erreur, et le secours aussi.
 */
export class BikeRouteError extends Error {
  readonly reason: "offline" | "noRoute" | "service";
  readonly status?: number;
  constructor(reason: "offline" | "noRoute" | "service", status?: number) {
    super(`bike route: ${reason}${status ? ` (${status})` : ""}`);
    this.reason = reason;
    this.status = status;
  }
}

/**
 * Les réponses récentes, par profil et par parcours. Le panneau calcule le
 * plus rapide, puis « Démarrer » demande les deux : sans ce cache, le même
 * trajet serait demandé deux fois en quelques secondes, sur un serveur qui
 * n'en accepte qu'un par seconde. Deux minutes suffisent à couvrir ce geste.
 */
const CACHE_MS = 2 * 60_000;
const cache = new Map<string, { at: number; value: Promise<BikeRoute> }>();

/**
 * L'itinéraire à vélo passant par ces points, dans l'ordre.
 *
 * Le secours n'est tenté que si Valhalla est **injoignable ou en panne** —
 * réseau, 5xx, 429 — et jamais quand il répond qu'il n'y a pas de chemin : un
 * autre moteur n'en trouverait pas davantage.
 */
export function fetchBikeRoute(points: LonLat[], profile: BikeProfile, signal?: AbortSignal): Promise<BikeRoute> {
  if (points.length < 2) return Promise.reject(new BikeRouteError("noRoute"));
  const key = `${profile}|${points.map((p) => `${p.lon},${p.lat}`).join(";")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  // Le signal de l'appelant n'est **pas** transmis au calcul partagé : fermer
  // le panneau ne doit pas interrompre une requête dont « Démarrer », une
  // seconde plus tard, aura besoin. Il ne fait qu'abandonner l'attente.
  const value = computeBikeRoute(points, profile);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return signal ? abortable(value, signal) : value;
}

async function computeBikeRoute(points: LonLat[], profile: BikeProfile): Promise<BikeRoute> {
  try {
    return { source: "valhalla", route: await fromValhalla(points, profile) };
  } catch (e) {
    if (e instanceof BikeRouteError && e.reason === "noRoute") throw e;
    console.warn("[vélo] Valhalla indisponible, secours BRouter", e);
    return { source: "brouter", route: await fromBRouter(points, profile) };
  }
}

function abortable<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    value.then(resolve, reject);
  });
}

/** Une proposition au départ : son profil, sa réponse, et si elle vaut pour les deux. */
export interface BikeOption {
  profile: BikeProfile;
  bike: BikeRoute;
  /** Vrai quand le plus rapide et le plus sûr suivent les mêmes rues. */
  merged: boolean;
}

/**
 * Les propositions du départ : le plus rapide puis le plus sûr, ou **un seul
 * parcours quand ils suivent les mêmes rues**. C'est fréquent en ville, et le
 * plus sûr diffère alors par un détail invisible sur la carte : il roule sur la
 * piste qui longe la chaussée, à quelques mètres. Mesuré sur Nation → Opéra :
 * 5,82 km sur la chaussée contre 5,84 km sur la piste, les mêmes boulevards.
 * On garde alors **le plus sûr**, qui est aussi celui qui porte le vert.
 *
 * Le panneau d'itinéraire montre la première proposition, et la navigation en
 * fait ses bulles : les deux lisent cette même fonction, et la durée du
 * panneau est toujours celle de la première bulle. Les réponses sont en cache,
 * le départ ne rappelle donc pas les moteurs.
 */
export async function fetchBikeOptions(points: LonLat[], signal?: AbortSignal): Promise<BikeOption[]> {
  const [fast, safe] = await Promise.allSettled([
    fetchBikeRoute(points, "fast", signal),
    fetchBikeRoute(points, "safe", signal),
  ]);
  if (fast.status === "rejected" && safe.status === "rejected") throw fast.reason;
  if (fast.status === "rejected") return [{ profile: "safe", bike: (safe as PromiseFulfilledResult<BikeRoute>).value, merged: false }];
  if (safe.status === "rejected") return [{ profile: "fast", bike: fast.value, merged: false }];
  if (sameLine(fast.value.route.geometry.coordinates, safe.value.route.geometry.coordinates)) {
    return [{ profile: "safe", bike: safe.value, merged: true }];
  }
  return [
    { profile: "fast", bike: fast.value, merged: false },
    { profile: "safe", bike: safe.value, merged: false },
  ];
}

/** En deçà de cette distance, un point d'un tracé est « sur » l'autre : une piste le long d'une chaussée. */
const SAME_LINE_METERS = 30;
/** Part des points qui doivent se recouvrir, dans les deux sens. */
const SAME_LINE_SHARE = 0.95;

/**
 * Deux tracés qui empruntent les mêmes rues. Mesuré dans les deux sens : un
 * parcours qui ne fait que prolonger l'autre d'un détour ne se confond pas
 * avec lui.
 */
export function sameLine(a: GeoJSON.Position[], b: GeoJSON.Position[]): boolean {
  return covers(a, b) && covers(b, a);
}

function covers(line: GeoJSON.Position[], other: GeoJSON.Position[]): boolean {
  const step = Math.max(1, Math.floor(line.length / 60));
  let near = 0;
  let count = 0;
  for (let i = 0; i < line.length; i += step) {
    count++;
    const p = line[i] as [number, number];
    if (other.some((q) => meters(q as [number, number], p) <= SAME_LINE_METERS)) near++;
  }
  return count > 0 && near / count >= SAME_LINE_SHARE;
}

/** Vide le cache — pour les tests. */
export function clearBikeRouteCache() {
  cache.clear();
}

// --- Politesse envers les serveurs publics -----------------------------------

/**
 * Un appel par seconde au plus, tous moteurs confondus : c'est la règle du
 * Valhalla de la FOSSGIS, et BRouter n'en publie aucune — on lui applique la
 * même. Les appels se rangent chacun dans son créneau au lieu d'être refusés :
 * un recalcul de guidage qui tombe juste après celui du panneau attend une
 * seconde, il ne rate pas.
 */
const MIN_GAP_MS = 1000;
let nextSlot = 0;

async function politeSlot(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise<void>((resolve) => setTimeout(resolve, wait));
}

// --- Valhalla ---------------------------------------------------------------

/**
 * Les options vélo de Valhalla (docs/api/route/api-reference.md, « Bicycle
 * costing options »). Un vélo de ville (`hybrid`, le défaut du moteur), les
 * côtes au milieu (`use_hills` 0,5, le défaut aussi). Ce qui sépare les deux
 * profils est l'envie d'aller sur la route, `use_roads` :
 *
 * - `fast` à 1 : la route ne gêne pas, seul le temps compte ;
 * - `safe` à 0 : pistes, bandes et chemins d'abord.
 *
 * Mesuré sur Nation → Opéra (5,8 km dans les deux cas) : 21 % du trajet sur
 * pistes, bandes ou voies calmes à 1, 94 % à 0.
 */
export function valhallaCosting(profile: BikeProfile) {
  return { bicycle_type: "hybrid", use_roads: profile === "fast" ? 1 : 0, use_hills: 0.5 };
}

async function fromValhalla(points: LonLat[], profile: BikeProfile): Promise<OsrmLikeRoute> {
  const body = {
    locations: points.map((p) => ({ lon: p.lon, lat: p.lat })),
    costing: "bicycle",
    costing_options: { bicycle: valhallaCosting(profile) },
    format: "osrm",
    shape_format: "geojson",
  };
  await politeSlot();
  let res: Response;
  try {
    res = await fetch(CONFIG.BIKE_ROUTING.VALHALLA_URL, {
      method: "POST",
      // `X-Client-Id` est demandé par l'opérateur à qui se sert du serveur
      // public : il nomme l'application, rien de l'utilisateur.
      headers: { "Content-Type": "application/json", "X-Client-Id": CONFIG.BIKE_ROUTING.CLIENT_ID },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BikeRouteError("offline");
  }
  // 400 : la demande est comprise, et il n'y a pas de chemin — trop loin, point
  // hors du réseau cyclable. Ce n'est pas une panne.
  if (res.status === 400) throw new BikeRouteError("noRoute", 400);
  if (!res.ok) throw new BikeRouteError("service", res.status);
  const data = (await res.json()) as { code?: string; routes?: OsrmLikeRoute[] };
  if (data.code !== "Ok" || !data.routes?.length) throw new BikeRouteError("noRoute");
  return data.routes[0];
}

// --- BRouter ----------------------------------------------------------------

/**
 * Le profil BRouter. Le serveur public refuse les paramètres de profil
 * (`profile:avoid_unsafe=…` y rend une erreur 500, vérifié le 29 septembre
 * 2026) : seuls les profils nommés servent, `fastbike` et `safety` (tous deux
 * vérifiés en 200 le même jour).
 */
export function brouterProfile(profile: BikeProfile): "fastbike" | "safety" {
  return profile === "fast" ? "fastbike" : "safety";
}

interface BRouterFeature {
  geometry: { coordinates: Array<[number, number, number?]> };
  properties: {
    "total-time"?: string;
    /** `[indice du point, commande, sortie, distance jusqu'à la suivante, angle]`. */
    voicehints?: Array<[number, number, number, number, number]>;
    /** Secondes cumulées depuis le départ, une par point du tracé. */
    times?: number[];
  };
}

async function fromBRouter(points: LonLat[], profile: BikeProfile): Promise<OsrmLikeRoute> {
  const lonlats = points.map((p) => `${p.lon},${p.lat}`).join("|");
  // `timode=2` : le style « Locus », le seul où les sorties à gauche et à
  // droite gardent leur propre commande (`Formatter.getJsonCommandIndex`).
  const url =
    `${CONFIG.BIKE_ROUTING.BROUTER_URL}?lonlats=${lonlats}` +
    `&profile=${brouterProfile(profile)}&alternativeidx=0&format=geojson&timode=2`;
  await politeSlot();
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new BikeRouteError("offline");
  }
  // BRouter répond en texte, et en 500, quand il ne trouve pas de chemin comme
  // quand il tombe : on ne peut pas les distinguer, on dit donc « pas de
  // chemin » plutôt qu'accuser un serveur qui a peut-être bien répondu.
  if (!res.ok) throw new BikeRouteError(res.status >= 500 ? "noRoute" : "service", res.status);
  let feature: BRouterFeature | undefined;
  try {
    feature = ((await res.json()) as { features?: BRouterFeature[] }).features?.[0];
  } catch {
    throw new BikeRouteError("noRoute");
  }
  if (!feature || feature.geometry.coordinates.length < 2) throw new BikeRouteError("noRoute");
  return brouterToOsrm(feature, points);
}

/**
 * Commande BRouter → type et modificateur OSRM (`VoiceHint.java`). Les
 * numéros absents (12, hors itinéraire ; 100, arrivée) ne font pas d'étape :
 * l'arrivée est fabriquée à la fin de chaque tronçon.
 */
const COMMANDS: Record<number, { type: string; modifier?: string }> = {
  1: { type: "continue", modifier: "straight" },
  2: { type: "turn", modifier: "left" },
  3: { type: "turn", modifier: "slight left" },
  4: { type: "turn", modifier: "sharp left" },
  5: { type: "turn", modifier: "right" },
  6: { type: "turn", modifier: "slight right" },
  7: { type: "turn", modifier: "sharp right" },
  8: { type: "fork", modifier: "slight left" },
  9: { type: "fork", modifier: "slight right" },
  10: { type: "turn", modifier: "uturn" },
  11: { type: "turn", modifier: "uturn" },
  13: { type: "roundabout" },
  14: { type: "roundabout" },
  15: { type: "turn", modifier: "uturn" },
  16: { type: "continue", modifier: "straight" },
  17: { type: "off ramp", modifier: "slight left" },
  18: { type: "off ramp", modifier: "slight right" },
};

/**
 * Traduit un tracé BRouter en tronçons et étapes OSRM.
 *
 * BRouter rend un tracé unique, étapes comprises : il est recoupé au point le
 * plus proche de chaque étape, dans l'ordre, pour que le guidage retrouve ses
 * arrivées intermédiaires. Les rues n'ont pas de nom — BRouter n'en donne
 * pas — et les consignes se disent donc sans : « Tournez à droite ».
 */
export function brouterToOsrm(feature: BRouterFeature, points: LonLat[]): OsrmLikeRoute {
  const coords = feature.geometry.coordinates.map(([lon, lat]) => [lon, lat] as [number, number]);
  const last = coords.length - 1;
  const totalTime = Number(feature.properties["total-time"]) || 0;
  // Sans `times`, la durée se répartit à la distance : tout vaut mieux qu'une
  // étape à zéro seconde, qui fausserait l'heure d'arrivée.
  const cumulative = cumulativeMeters(coords);
  const timeAt = (i: number): number => {
    const times = feature.properties.times;
    if (times && times.length === coords.length) return times[i];
    return cumulative[last] > 0 ? (cumulative[i] / cumulative[last]) * totalTime : 0;
  };

  // Où couper : le point du tracé le plus proche de chaque étape, cherché en
  // avançant pour qu'un parcours qui repasse au même endroit ne se replie pas.
  const cuts: number[] = [0];
  for (const via of points.slice(1, -1)) {
    const from = cuts[cuts.length - 1];
    let best = from;
    let bestDistance = Infinity;
    for (let i = from; i <= last; i++) {
      const d = meters(coords[i], [via.lon, via.lat]);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    cuts.push(best);
  }
  cuts.push(last);

  const hints = (feature.properties.voicehints ?? [])
    .filter(([index, command]) => COMMANDS[command] && index > 0 && index < last)
    .sort((a, b) => a[0] - b[0]);

  const step = (
    start: number,
    end: number,
    maneuver: { type: string; modifier?: string; exit?: number }
  ): OsrmLikeStep => ({
    distance: cumulative[end] - cumulative[start],
    duration: Math.max(0, timeAt(end) - timeAt(start)),
    name: "",
    geometry: { type: "LineString", coordinates: coords.slice(start, end + 1) },
    maneuver: { ...maneuver, location: coords[start] },
  });

  const legs = cuts.slice(0, -1).map((legStart, legIndex) => {
    const legEnd = cuts[legIndex + 1];
    const starts = [legStart];
    const maneuvers: Array<{ type: string; modifier?: string; exit?: number }> = [{ type: "depart" }];
    for (const [index, command, exit] of hints) {
      if (index <= legStart || index >= legEnd) continue;
      const known = COMMANDS[command];
      starts.push(index);
      maneuvers.push(known.type === "roundabout" ? { ...known, exit: Math.abs(exit) || undefined } : known);
    }
    const steps = starts.map((start, i) => step(start, starts[i + 1] ?? legEnd, maneuvers[i]));
    // L'arrivée, comme chez OSRM : une étape de longueur nulle au bout du tronçon.
    steps.push(step(legEnd, legEnd, { type: "arrive" }));
    // Une étape d'un seul point n'a pas de géométrie traçable : on la double.
    for (const s of steps) {
      if (s.geometry.coordinates.length === 1) s.geometry.coordinates.push(s.geometry.coordinates[0]);
    }
    return { steps };
  });

  return {
    distance: cumulative[last],
    duration: totalTime || timeAt(last),
    geometry: { type: "LineString", coordinates: coords },
    legs,
  };
}

function cumulativeMeters(coords: Array<[number, number]>): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + meters(coords[i - 1], coords[i]));
  return out;
}

/** Distance à vol d'oiseau (haversine), en mètres. */
function meters(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// --- Pistes et bandes cyclables le long d'un tracé ----------------------------

/**
 * Les portions d'un tracé sur piste ou bande cyclable, pour les dessiner en
 * vert (demande du 29 septembre 2026 : « pistes et bandes », sur les parcours
 * proposés et pendant la navigation).
 *
 * C'est `trace_attributes` de Valhalla qui les donne : pour chaque tronçon
 * parcouru, son usage (`use`) et son aménagement (`cycle_lane` : `none`,
 * `shared`, `dedicated`, `separated`), avec sa place dans le tracé qu'il rend
 * (`shape`, polyligne de précision 6). Vert :
 *
 * - `use: cycleway` — piste, voie verte, quel que soit l'aménagement ;
 * - `cycle_lane: dedicated` — bande peinte ; `separated` — piste le long d'une
 *   route.
 *
 * Restent bleus : la route, la voie partagée (`shared` : pictogramme au sol,
 * couloir de bus), le trottoir. Un appel de plus par parcours : le tracé
 * s'affiche d'abord, le vert suit. Un échec ne rend rien — le tracé reste
 * bleu, ce qui n'est faux nulle part.
 */
export async function fetchCycleways(line: Array<[number, number]>): Promise<CyclewayStretch> {
  await politeSlot();
  const res = await fetch(CONFIG.BIKE_ROUTING.TRACE_ATTRIBUTES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": CONFIG.BIKE_ROUTING.CLIENT_ID },
    body: JSON.stringify({
      shape: line.map(([lon, lat]) => ({ lon, lat })),
      costing: "bicycle",
      // `map_snap` et non `edge_walk` : le tracé de secours vient de BRouter,
      // qui ne suit pas forcément les tronçons de Valhalla à l'identique.
      shape_match: "map_snap",
      filters: {
        attributes: ["edge.use", "edge.cycle_lane", "edge.begin_shape_index", "edge.end_shape_index", "shape"],
        action: "include",
      },
    }),
  });
  if (!res.ok) throw new Error(`trace_attributes ${res.status}`);
  return cyclewaysFromAttributes(await res.json());
}

export interface CyclewayStretch {
  /** Les portions vertes, chacune d'un seul tenant. */
  segments: GeoJSON.LineString[];
  /** Part du trajet sur piste ou bande, de 0 à 1. */
  share: number;
}

interface TraceAttributes {
  shape?: string;
  edges?: Array<{ use?: string; cycle_lane?: string; begin_shape_index?: number; end_shape_index?: number }>;
}

/** Tri des tronçons, et fusion des tronçons verts qui se suivent. */
export function cyclewaysFromAttributes(data: TraceAttributes): CyclewayStretch {
  const shape = data.shape ? (decodePolyline(data.shape, 6) as Array<[number, number]>) : [];
  const segments: GeoJSON.LineString[] = [];
  let green = 0;
  let total = 0;
  let current: Array<[number, number]> | null = null;
  for (const edge of data.edges ?? []) {
    const begin = edge.begin_shape_index ?? 0;
    const end = edge.end_shape_index ?? begin;
    const part = shape.slice(begin, end + 1);
    const length = lineMeters(part);
    total += length;
    const isGreen = edge.use === "cycleway" || edge.cycle_lane === "dedicated" || edge.cycle_lane === "separated";
    if (!isGreen || part.length < 2) {
      if (current) segments.push({ type: "LineString", coordinates: current });
      current = null;
      continue;
    }
    green += length;
    // Deux tronçons verts consécutifs partagent leur point de jonction.
    current = current ? [...current, ...part.slice(1)] : part;
  }
  if (current) segments.push({ type: "LineString", coordinates: current });
  return { segments, share: total > 0 ? green / total : 0 };
}

function lineMeters(line: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 1; i < line.length; i++) sum += meters(line[i - 1], line[i]);
  return sum;
}
