import { providersFor, resolveRegion } from "../transport/registry";
import type { LonLat } from "../types";
import { distance } from "./geo";

// ---------------------------------------------------------------------------
// Par quelle sortie quitter une station.
//
// Le jeu ouvert « acces » d'Île-de-France Mobilités recense les accès du réseau
// ferré : 2 523 entrées, chacune avec son **numéro** (`accshortname`), le nom
// de la rue ou du repère qu'elle dessert (`accname`), ses coordonnées, et si
// elle sert d'entrée, de sortie, ou des deux. Sans clé, origine croisée
// autorisée — mesuré, comme le reste des jeux ouverts déjà utilisés par
// `idfmNetwork.ts`.
//
// Le choix ne se fait pas au hasard parmi les sorties d'une station : on retient
// **celle qui rapproche le plus de la suite du trajet**. À Gare de Lyon, la
// sortie « r. de Chalon » et la sortie « Ministère de l'Économie » sont à trois
// cents mètres l'une de l'autre — se tromper coûte plus que de n'avoir rien dit.
//
// Deux limites, que l'interface ne cache pas : le jeu ne couvre que le réseau
// ferré — un arrêt de bus n'a pas de sortie, et il n'en faut pas — et une
// station absente du jeu ne rend simplement aucune indication.
// ---------------------------------------------------------------------------

const ENDPOINT =
  "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/acces/records";

/** Rayon de recherche autour de l'arrêt. Une grande gare étale ses accès. */
const SEARCH_RADIUS_M = 350;

/** Au-delà, l'accès trouvé appartient sans doute à une autre station. */
const MAX_FROM_STOP_M = 400;

export interface StationExit {
  /** Numéro de la sortie, quand elle en porte un. */
  number: string | null;
  /** Ce qu'elle dessert : une rue, une place, un bâtiment. */
  name: string;
  coord: LonLat;
}

interface AccessRecord {
  accname?: string | null;
  accshortname?: string | number | null;
  accisexit?: string | boolean | null;
  accgeopoint?: { lon?: number; lat?: number } | null;
}

interface AccessResponse {
  results?: AccessRecord[];
}

/**
 * Les sorties déjà cherchées, gardées le temps de la session. Une station
 * revient d'un trajet à l'autre, et le jeu ne bouge pas dans la journée.
 */
const cache = new Map<string, StationExit[]>();

function key(stop: LonLat): string {
  return `${stop.lon.toFixed(4)},${stop.lat.toFixed(4)}`;
}

/** Les sorties autour d'un arrêt. Liste vide quand la station n'en déclare pas. */
async function exitsNear(stop: LonLat, signal?: AbortSignal): Promise<StationExit[]> {
  const cached = cache.get(key(stop));
  if (cached) return cached;

  const url = new URL(ENDPOINT);
  // Le filtre géographique de l'API Explore attend le point en `lon lat`,
  // l'ordre inverse de celui d'un couple de coordonnées écrit à la main.
  url.searchParams.set(
    "where",
    `distance(accgeopoint, geom'POINT(${stop.lon} ${stop.lat})', ${SEARCH_RADIUS_M}m)`
  );
  url.searchParams.set("limit", "40");
  url.searchParams.set("select", "accname,accshortname,accisexit,accgeopoint");

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(String(res.status));
  const data: AccessResponse = await res.json();

  const exits = (data.results ?? []).flatMap<StationExit>((record) => {
    const point = record.accgeopoint;
    if (!point || typeof point.lon !== "number" || typeof point.lat !== "number") return [];
    // Le champ arrive en chaîne (`"true"`) et non en booléen ; les accès qui ne
    // servent qu'à entrer sont écartés — on cherche par où sortir.
    if (String(record.accisexit) !== "true") return [];
    const coord = { lon: point.lon, lat: point.lat };
    if (distance(stop, coord) > MAX_FROM_STOP_M) return [];
    const number = record.accshortname == null ? null : String(record.accshortname).trim();
    return [{ number: number || null, name: (record.accname ?? "").trim(), coord }];
  });

  cache.set(key(stop), exits);
  return exits;
}

/**
 * La sortie à prendre pour poursuivre vers `towards`.
 *
 * `null` quand la station n'a pas d'accès connu — un arrêt de bus, une gare
 * absente du jeu — ou quand la source ne répond pas. C'est un renseignement de
 * plus, jamais une condition du guidage.
 */
export async function bestExit(
  stop: LonLat,
  towards: LonLat | undefined,
  signal?: AbortSignal
): Promise<StationExit | null> {
  // Le jeu ne couvre que l'Île-de-France : ailleurs, ne pas envoyer à IDFM la
  // position d'une station de Tokyo pour une réponse vide. C'est le registre
  // des régions qui dit où une source de sorties existe.
  if (!providersFor(resolveRegion(stop.lon, stop.lat, null), "exits").length) return null;
  const exits = await exitsNear(stop, signal).catch(() => []);
  if (!exits.length) return null;
  // Sans suite connue — la station est l'arrivée — la sortie la plus proche de
  // l'arrêt vaut mieux qu'un choix arbitraire.
  const target = towards ?? stop;
  let best = exits[0];
  let bestDistance = distance(target, best.coord);
  for (const exit of exits.slice(1)) {
    const d = distance(target, exit.coord);
    if (d < bestDistance) {
      best = exit;
      bestDistance = d;
    }
  }
  return best;
}
