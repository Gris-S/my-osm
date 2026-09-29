import { CONFIG } from "../config";
import type { LonLat } from "../types";
import { bikeSettings, type BikeSettings } from "./bikeSettings";

// ---------------------------------------------------------------------------
// L'itinéraire à vélo : Valhalla d'abord, BRouter en secours **annoncé**.
//
// Les deux réponses sont ramenées à **la forme d'OSRM avec `steps=true`** —
// celle que le guidage à pied lit déjà (`navigation/route.ts`). Valhalla la
// produit lui-même (`format: "osrm"`) ; celle de BRouter est traduite ici.
// Le panneau d'itinéraire et le guidage partagent donc un seul appel, et un
// seul lecteur de manœuvres.
//
// Pourquoi ces deux moteurs, et pas l'OSRM vélo de la FOSSGIS : voir
// `CONFIG.BIKE_ROUTING`.
// ---------------------------------------------------------------------------

/** Le moteur qui a répondu. `brouter` ne sert qu'en secours, et se dit. */
export type BikeSource = "valhalla" | "brouter";

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
 * - `service` : le moteur a répondu une erreur, secours interdit ou raté.
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
 * L'itinéraire à vélo passant par ces points, dans l'ordre.
 *
 * Le secours n'est tenté que si Valhalla est **injoignable ou en panne** —
 * réseau, 5xx, 429 — et jamais quand il répond qu'il n'y a pas de chemin : un
 * autre moteur n'en trouverait pas davantage, et changer de moteur pour une
 * mauvaise raison masquerait la vraie.
 */
export async function fetchBikeRoute(points: LonLat[], signal?: AbortSignal): Promise<BikeRoute> {
  if (points.length < 2) throw new BikeRouteError("noRoute");
  const settings = bikeSettings();
  try {
    return { source: "valhalla", route: await fromValhalla(points, settings, signal) };
  } catch (e) {
    if (signal?.aborted) throw e;
    const recoverable = !(e instanceof BikeRouteError) || e.reason !== "noRoute";
    if (!recoverable || !settings.allowFallback) throw e;
    console.warn("[vélo] Valhalla indisponible, secours BRouter", e);
    return { source: "brouter", route: await fromBRouter(points, settings, signal) };
  }
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

async function politeSlot(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (!wait) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, wait);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

// --- Valhalla ---------------------------------------------------------------

/**
 * Les options vélo de Valhalla (docs/api/route/api-reference.md, « Bicycle
 * costing options »). Le vélo est un `hybrid` — un vélo de ville, le défaut du
 * moteur — et les curseurs s'y traduisent à l'envers : Valhalla demande
 * l'envie d'aller sur la route et dans les côtes, on règle l'envie de les
 * éviter.
 */
export function valhallaCosting(settings: BikeSettings) {
  const useRoads = settings.safety ? 0 : 1 - settings.avoidTraffic;
  // À assistance électrique, le moteur monte les côtes : elles ne pèsent plus
  // qu'au tiers de ce que le curseur demande.
  const hillWeight = settings.electric ? settings.avoidHills / 3 : settings.avoidHills;
  return {
    bicycle_type: "hybrid",
    use_roads: round2(useRoads),
    use_hills: round2(1 - hillWeight),
    // 22 km/h : sous les 25 où l'assistance se coupe, la croisière d'un VAE en
    // ville. Sans assistance, le défaut du moteur pour un `hybrid` (18 km/h).
    ...(settings.electric ? { cycling_speed: 22 } : {}),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fromValhalla(points: LonLat[], settings: BikeSettings, signal?: AbortSignal): Promise<OsrmLikeRoute> {
  const body = {
    locations: points.map((p) => ({ lon: p.lon, lat: p.lat })),
    costing: "bicycle",
    costing_options: { bicycle: valhallaCosting(settings) },
    format: "osrm",
    shape_format: "geojson",
  };
  await politeSlot(signal);
  let res: Response;
  try {
    res = await fetch(CONFIG.BIKE_ROUTING.VALHALLA_URL, {
      method: "POST",
      // `X-Client-Id` est demandé par l'opérateur à qui se sert du serveur
      // public : il nomme l'application, rien de l'utilisateur.
      headers: { "Content-Type": "application/json", "X-Client-Id": CONFIG.BIKE_ROUTING.CLIENT_ID },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
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
 * 2026) : seuls les profils nommés servent. `safety` pour qui veut la sécurité
 * ou fuit franchement la circulation, `trekking` — le vélo de randonnée et de
 * ville, qui préfère déjà les pistes et tient compte du relief — sinon.
 */
export function brouterProfile(settings: BikeSettings): "safety" | "trekking" {
  return settings.safety || settings.avoidTraffic >= 0.9 ? "safety" : "trekking";
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

async function fromBRouter(points: LonLat[], settings: BikeSettings, signal?: AbortSignal): Promise<OsrmLikeRoute> {
  const lonlats = points.map((p) => `${p.lon},${p.lat}`).join("|");
  // `timode=2` : le style « Locus », le seul où les sorties à gauche et à
  // droite gardent leur propre commande (`Formatter.getJsonCommandIndex`).
  const url =
    `${CONFIG.BIKE_ROUTING.BROUTER_URL}?lonlats=${lonlats}` +
    `&profile=${brouterProfile(settings)}&alternativeidx=0&format=geojson&timode=2`;
  await politeSlot(signal);
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
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
