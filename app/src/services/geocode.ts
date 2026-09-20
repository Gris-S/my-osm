import { CONFIG } from "../config";
import type { LonLat, Place } from "../types";
import { groupFromTags } from "../filters";
import { searchOffline } from "./offline";
import { t } from "../i18n";
import { cleanAddress } from "./webPlace";

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id: number;
    osm_type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

/**
 * Photon désigne le type d'objet OSM par une initiale (`N`, `W`, `R`).
 * On le réécrit en toutes lettres pour obtenir la même forme `type/id` que les
 * POI venus des tuiles — c'est cette clé qui permet ensuite d'aller chercher
 * horaires et téléphone du lieu (voir `services/overpass.ts`).
 */
const OSM_TYPE_BY_INITIAL: Record<string, string> = { N: "node", W: "way", R: "relation" };

function osmRef(osmType: string | undefined, osmId: number): string {
  const type = OSM_TYPE_BY_INITIAL[(osmType ?? "N").toUpperCase()] ?? "node";
  return `${type}/${osmId}`;
}

/**
 * Les arrêts tels que Photon les rend. Les quais du métro arrivent en
 * `railway=stop`, les poteaux en `highway=bus_stop` : sans les reconnaître, une
 * recherche « Bastille » listait quatre « adresses » Bastille à côté de la
 * station, au lieu de les réunir sous elle (19 septembre 2026).
 */
const TRANSIT_TAGS: Record<string, string[]> = {
  // Les entrées aussi : six « Gare du Nord » sur vingt résultats en sont, et
  // elles se fondent dans la station.
  railway: ["station", "halt", "stop", "tram_stop", "platform", "train_station_entrance", "subway_entrance"],
  highway: ["bus_stop"],
  amenity: ["bus_station"],
  public_transport: ["station", "stop_position", "platform"],
  // Le bâtiment de la gare (« Gare de Lyon », « Gare Saint-Lazare »).
  building: ["train_station"],
};

/**
 * Le type d'arrêt que l'application connaît (`TRANSIT_FAMILIES`), pour ce que
 * Photon rend. Un quai ou un point d'arrêt n'a pas de famille à lui : il est
 * rangé avec les arrêts ferrés, et se fond de toute façon dans la station du
 * même nom (`groupStops`). « Opéra » rendait quatre quais listés comme des
 * adresses, qui prenaient la moitié des résultats (19 septembre 2026).
 */
function transitRawType(key: string, value: string): string {
  if (key === "public_transport") return value === "station" ? "station" : "stop";
  if (key === "building") return "station";
  if (value === "platform") return "stop";
  return value;
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const addressParts = [p.housenumber, p.street, p.postcode, p.city].filter(Boolean);
  // Une adresse sans nom : le numéro et la rue en titre, la ville dessous.
  // Sans cette coupe, « 56 Rue de la Roquette 75011 Paris » s'écrivait deux fois.
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const town = [p.postcode, p.city].filter(Boolean).join(" ");
  const transit = !!p.osm_key && !!p.osm_value && (TRANSIT_TAGS[p.osm_key] ?? []).includes(p.osm_value);
  return {
    id: osmRef(p.osm_type, p.osm_id),
    name: p.name || street || addressParts.join(" ") || t("place.unnamed"),
    group: transit ? "transport" : p.osm_key && p.osm_value ? groupFromTags({ [p.osm_key]: p.osm_value }) : null,
    rawType: transit && p.osm_key && p.osm_value ? transitRawType(p.osm_key, p.osm_value) : p.osm_value,
    lon,
    lat,
    address: p.name || !street ? addressParts.join(" ") : town,
  };
}

export function normalizeBrand(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Le nom contient-il l'enseigne, mot pour mot ?
 *
 * La comparaison se fait mot entier contre mot entier : « BUT » reconnaît
 * « But » et « But Cuisines », mais pas « Buttes-Chaumont » ni « Rambuteau ».
 * Un début de mot ne suffisait pas — c'est précisément ce qui ramenait la
 * butte — et une simple inclusion encore moins.
 *
 * Les mots de l'enseigne doivent se suivre : « burger king » reconnaît
 * « Burger King Rivoli », pas « Burger et King ».
 */
export function matchesBrand(name: string, normalizedQuery: string): boolean {
  const nameWords = normalizeBrand(name).split(" ").filter(Boolean);
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  if (queryWords.length === 0) return false;

  for (let start = 0; start + queryWords.length <= nameWords.length; start++) {
    if (queryWords.every((word, offset) => nameWords[start + offset] === word)) return true;
  }
  return false;
}

interface BanFeature {
  geometry: { coordinates: [number, number] };
  properties: { id?: string; label?: string; name?: string; postcode?: string; city?: string; type?: string; score?: number };
}

/** Adresse de la Base Adresse Nationale, ramenée à la forme commune. */
function banToPlace(feature: BanFeature): Place {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const address = [p.postcode, p.city].filter(Boolean).join(" ");
  return {
    // Pas un identifiant OSM : la fiche n'ira donc pas chercher d'horaires,
    // ce qui est correct pour une adresse.
    id: `ban/${p.id ?? `${lon},${lat}`}`,
    name: p.name || p.label || t("place.address"),
    group: null,
    lon,
    lat,
    address: address || undefined,
  };
}

/**
 * Recherche de repli, quand le géocodeur principal ne répond pas.
 *
 * La Base Adresse Nationale couvre adresses, voies et communes — pas les
 * commerces par leur nom. Une recherche de lieu y perd donc en portée, mais la
 * barre continue de servir au lieu de ne rien rendre du tout.
 */
async function searchAddresses(query: string, near: LonLat): Promise<Place[]> {
  const url = new URL(CONFIG.BAN_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lon", String(near.lon));
  url.searchParams.set("lat", String(near.lat));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Recherche échouée (${res.status})`);
  const data = (await res.json()) as { features?: BanFeature[] };
  return (data.features ?? []).map(banToPlace);
}

/**
 * Score minimal d'une réponse de la BAN pour une adresse lue sur le web. Mesuré :
 * l'adresse brute d'une fiche DuckDuckGo (abréviation, route nationale, code
 * pays) obtient 0,52 et c'est bien le bon numéro ; en dessous de 0,4, la BAN
 * rapproche des voies sans rapport.
 */
const BAN_MIN_SCORE = 0.4;

/**
 * Une adresse lue sur une page web (recherche sur le web, `services/webSearch.ts`).
 *
 * Photon d'abord, sur l'adresse nettoyée (`cleanAddress`), puis la BAN **quand
 * Photon ne rend rien** — et pas seulement quand il échoue, comme pour la barre.
 * Mesuré sur la fiche DuckDuckGo d'un McDonald's absent d'OSM : « 3 Rte de
 * Lalande Nationale 89, Montussan, FR 33450 » ne donnait rien à Photon, et la
 * BAN rend le numéro exact. La BAN n'est interrogée que pour une adresse à code
 * postal français, et **aucune position de l'appareil n'est envoyée** : une
 * adresse de page porte sa ville.
 */
export async function geocodeAddress(text: string): Promise<Place | null> {
  const cleaned = cleanAddress(text);
  if (!cleaned) return null;
  const found = await searchPlaces(cleaned, CONFIG.DEFAULT_CENTER).catch((): Place[] => []);
  if (found[0]) return found[0];
  if (!/\b\d{5}\b/.test(cleaned) || !navigator.onLine) return null;
  try {
    const url = new URL(CONFIG.BAN_URL);
    url.searchParams.set("q", cleaned);
    url.searchParams.set("limit", "1");
    const res = await fetch(url);
    if (!res.ok) return null;
    const best = ((await res.json()) as { features?: BanFeature[] }).features?.[0];
    return best && (best.properties.score ?? 0) >= BAN_MIN_SCORE ? banToPlace(best) : null;
  } catch {
    return null;
  }
}

/**
 * Recherche de lieux/adresses par texte libre, biaisée autour d'un point.
 * `signal` interrompt la requête, et une recherche interrompue ne se rabat pas
 * sur la BAN : c'est qu'une saisie plus récente l'a remplacée.
 */
export async function searchPlaces(query: string, near = CONFIG.DEFAULT_CENTER, signal?: AbortSignal): Promise<Place[]> {
  if (!query.trim()) return [];
  const url = new URL(CONFIG.PHOTON_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("lang", "fr");
  // Plus qu'on n'en montre : une station arrive avec ses quais, son arrêt de
  // bus, ses points d'arrêt — cinq résultats sur huit pour « Opéra ». Réunis
  // (`groupStops`), ils laissent la place aux autres lieux du même nom.
  url.searchParams.set("limit", String(CONFIG.SEARCH_FETCH_RESULTS));
  url.searchParams.set("lat", String(near.lat));
  url.searchParams.set("lon", String(near.lon));

  // Hors ligne déclaré par le navigateur : inutile d'attendre que trois
  // géocodeurs distants expirent l'un après l'autre, on va droit aux zones
  // téléchargées.
  if (!navigator.onLine) return searchOffline(query);

  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) throw new Error(`Recherche échouée (${res.status})`);
    const data: PhotonResponse = await res.json();
    return data.features.map(toPlace);
  } catch (error) {
    if (signal?.aborted) throw error;
    // Géocodeur injoignable : les adresses d'abord — c'est le repli d'origine,
    // et il vaut mieux qu'une zone partielle quand le réseau est là — puis les
    // zones téléchargées si la BAN ne répond pas non plus.
    const addresses = await searchAddresses(query, near);
    if (addresses.length) return addresses;
    return searchOffline(query);
  }
}

/** Géocodage inverse : coordonnées -> adresse la plus proche. */
export async function reverseGeocode(lon: number, lat: number): Promise<Place | null> {
  const url = new URL(CONFIG.PHOTON_REVERSE_URL);
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("lat", String(lat));

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Géocodage inverse échoué (${res.status})`);
    const data: PhotonResponse = await res.json();
    return data.features[0] ? toPlace(data.features[0]) : null;
  } catch {
    // Même repli que pour la recherche : l'adresse la plus proche vaut mieux
    // que « Position sélectionnée ».
    try {
      const banUrl = new URL(CONFIG.BAN_REVERSE_URL);
      banUrl.searchParams.set("lon", String(lon));
      banUrl.searchParams.set("lat", String(lat));
      const res = await fetch(banUrl);
      if (!res.ok) return null;
      const data = (await res.json()) as { features?: BanFeature[] };
      return data.features?.[0] ? banToPlace(data.features[0]) : null;
    } catch {
      return null;
    }
  }
}
