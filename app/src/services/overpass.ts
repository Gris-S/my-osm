import { CONFIG } from "../config";
import { getOfflineDetails } from "./offline";
import type { Place } from "../types";
import { groupFromTags } from "../filters";
import { matchesBrand, normalizeBrand } from "./geocode";

// ---------------------------------------------------------------------------
// Détails d'un lieu, demandés pour ce seul lieu à l'ouverture de sa fiche.
//
// Les POI affichés sur la carte viennent des tuiles vectorielles
// (`services/tilePois.ts`), qui portent le nom et la catégorie mais pas les
// horaires, le téléphone ni l'adresse. Ces champs ne sont donc cherchés qu'à
// l'ouverture d'une fiche : une requête sur un objet précis, sans emprise ni
// filtre de tags — sans commune mesure avec l'interrogation d'une zone entière,
// qui demandait des dizaines de secondes et faisait attendre toute la carte.
//
// Deux sources, interrogées dans l'ordre et sans jamais bloquer l'affichage :
// les instances Overpass publiques d'abord (c'est l'API de lecture prévue pour
// ça), puis l'API OpenStreetMap en dernier recours, qui rend un objet par son
// identifiant sans file d'attente. Les deux répondent le même JSON
// (`{ elements: [{ tags }] }`), d'où un seul décodage.
// ---------------------------------------------------------------------------

export type PlaceDetails = Pick<Place, "address" | "openingHours" | "phone" | "website" | "wikidata" | "wikipedia">;

interface OsmElement {
  type?: "node" | "way" | "relation";
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OsmResponse {
  elements: OsmElement[];
}

/** `node/12345`, `way/678`… tel que le construit `services/tilePois.ts`. */
const OSM_REF = /^(node|way|relation)\/(\d+)$/;

export function isOsmRef(id: string): boolean {
  return OSM_REF.test(id);
}

// Les détails d'un lieu ne changent pas d'une ouverture à l'autre : on garde
// la réponse pour que rouvrir une fiche déjà consultée soit instantané.
const cache = new Map<string, PlaceDetails>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `fetch` abandonné au bout de `CONFIG.OVERPASS_TIMEOUT_MS`, ou sur demande. */
async function fetchJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs = CONFIG.OVERPASS_TIMEOUT_MS
): Promise<OsmResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal.addEventListener("abort", abort);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`Réponse ${res.status} de ${url}`);
    return (await res.json()) as OsmResponse;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/**
 * Lance les sources l'une après l'autre et retient la première réponse.
 *
 * Les instances Overpass publiques tombent, saturent, ou limitent le débit par
 * adresse IP. Les essayer strictement en série fait payer l'attente complète de
 * chacune ; les lancer toutes ensemble leur inflige un travail inutile. La
 * suivante n'est donc ajoutée que si les précédentes n'ont rien rendu au bout
 * de `OVERPASS_HEDGE_MS` — un échec franc, lui, fait basculer aussitôt.
 */
async function firstAnswer(
  attempts: ((signal: AbortSignal) => Promise<OsmResponse>)[],
  signal?: AbortSignal
): Promise<OsmResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);

  const running = new Set<Promise<OsmResponse>>();
  let lastError: unknown = new Error("Aucune source de détails configurée");

  try {
    for (const start of attempts) {
      // Le signal interne coupe les tentatives perdantes dès qu'une réponse
      // arrive, et relaie l'abandon demandé par l'appelant.
      const attempt: Promise<OsmResponse> = start(controller.signal).catch((error: unknown) => {
        lastError = error;
        running.delete(attempt);
        throw error;
      });
      running.add(attempt);

      // `Promise.any` rend la première réussite ; il échoue — donc rend
      // `undefined` — quand toutes les tentatives en cours ont échoué, ce qui
      // enchaîne aussitôt sur la source suivante.
      const winner = await Promise.race([
        Promise.any([...running]).catch(() => undefined),
        sleep(CONFIG.OVERPASS_HEDGE_MS).then(() => undefined),
      ]);
      if (winner) return winner;
      if (controller.signal.aborted) throw lastError;
    }

    // Plus de source à ajouter : reste à attendre celles qui courent encore.
    if (running.size > 0) {
      try {
        return await Promise.any([...running]);
      } catch {
        /* toutes ont échoué : `lastError` porte la dernière raison */
      }
    }
    throw lastError;
  } finally {
    signal?.removeEventListener("abort", abort);
    controller.abort(); // libère les sources encore en train de répondre
  }
}

/**
 * Échappe ce que l'utilisateur a tapé : la saisie part dans une expression
 * régulière, elle-même logée dans une chaîne entre guillemets de la requête
 * Overpass. Les deux niveaux doivent être neutralisés.
 */
function overpassPattern(value: string): string {
  return value
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/["\\]/g, "\\$&");
}

function elementToPlace(element: OsmElement): Place | null {
  const tags = element.tags ?? {};
  const name = tags.name;
  const lon = element.lon ?? element.center?.lon;
  const lat = element.lat ?? element.center?.lat;
  if (!name || lon === undefined || lat === undefined || !element.type || element.id === undefined) return null;

  const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:postcode"], tags["addr:city"]]
    .filter(Boolean)
    .join(" ");

  return {
    id: `${element.type}/${element.id}`,
    name,
    group: groupFromTags(tags),
    rawType: tags.shop ?? tags.amenity ?? tags.leisure ?? tags.tourism ?? tags.historic ?? tags.natural,
    lon,
    lat,
    address: address || undefined,
    openingHours: tags.opening_hours,
    phone: tags.phone ?? tags["contact:phone"],
    website: tags.website ?? tags["contact:website"],
  };
}

export interface BrandSearchResult {
  places: Place[];
  /** Faux si la zone en cachait davantage que ce qu'on a su ramener. */
  complete: boolean;
}

/**
 * Tous les lieux d'une enseigne dans l'emprise donnée, **en une seule requête**.
 *
 * Le géocodeur, d'abord employé ici, plafonne ses réponses à cinquante entrées :
 * couvrir une grande zone demandait de la redécouper et pouvait coûter jusqu'à
 * quarante requêtes. Un service public gratuit ne le supporte pas — il finissait
 * par tout refuser, y compris l'autocomplétion de la barre de recherche, qui en
 * dépend aussi. Overpass, lui, est fait pour l'extraction en masse : une requête
 * rend la zone entière, jusqu'au plafond fixé ici, et son quota est distinct.
 *
 * Le filtrage final se refait côté client : la recherche par expression
 * régulière attrape « Buttes-Chaumont » pour « BUT », que la comparaison mot à
 * mot écarte.
 */
export async function searchBrandPlaces(
  query: string,
  bbox: [number, number, number, number],
  signal?: AbortSignal
): Promise<BrandSearchResult> {
  const wanted = normalizeBrand(query);
  if (!wanted) return { places: [], complete: true };

  const [south, west, north, east] = bbox.map((value) => Number(value.toFixed(5)));
  const overpassQuery =
    `[out:json][timeout:25];` +
    `nwr["name"~"^${overpassPattern(query.trim())}",i](${south},${west},${north},${east});` +
    `out center ${CONFIG.BRAND_SEARCH_LIMIT};`;

  const attempts = CONFIG.OVERPASS_URLS.map(
    (url) => (attemptSignal: AbortSignal) =>
      fetchJson(
        url,
        { method: "POST", headers: { "Content-Type": "text/plain" }, body: overpassQuery },
        attemptSignal
      )
  );

  const data = await firstAnswer(attempts, signal);
  const places: Place[] = [];
  for (const element of data.elements) {
    const place = elementToPlace(element);
    if (place && matchesBrand(place.name, wanted)) places.push(place);
  }

  return { places, complete: data.elements.length < CONFIG.BRAND_SEARCH_LIMIT };
}

/**
 * Essais sur une même instance qui répond « occupé » (429 ou 504). Mesuré le
 * 30 septembre 2026 sur overpass-api.de : de 50 à 75 % de réussite par essai
 * pour la requête des commerces hors tuiles, quelle que soit la taille de la
 * zone (1 ou 4 cases) — deux essais laissaient encore une vue sur quatre
 * vide ; quatre en laissent de l'ordre de 3 %.
 */
const BUSY_ATTEMPTS = 4;

/** Réponse de l'instance qui dit « trop de requêtes » : on attend un créneau. */
class RateLimited extends Error {}

/**
 * Le temps à attendre avant un créneau libre, lu sur la page d'état de
 * l'instance (`/api/status` : « Slot available after: …, in 24 seconds. »).
 * Mesuré le 30 septembre 2026 : 4 créneaux par adresse IP sur overpass-api.de,
 * chacun occupé un moment après la fin de sa requête.
 */
async function slotWaitMs(url: string, signal?: AbortSignal): Promise<number> {
  try {
    const res = await fetch(url.replace(/interpreter$/, "status"), { signal });
    const text = await res.text();
    if (/\d+ slots? available now/.test(text)) return 1000;
    const seconds = Number(text.match(/in (\d+) seconds/)?.[1]);
    return Number.isFinite(seconds) ? (seconds + 1) * 1000 : 10_000;
  } catch {
    return 10_000;
  }
}

/**
 * Une requête Overpass **qui respecte le quota** au lieu de s'en faire refuser :
 * les instances une par une (pas de lancement en parallèle, qui prendrait un
 * créneau de plus à chacune) ; sur un 429, attente du créneau annoncé — 30 s
 * au plus — puis un second essai sur la même instance. Une instance muette ou
 * en panne fait passer à la suivante.
 *
 * Constaté : la vue découpée en quatre requêtes, plus les fiches de lieux,
 * épuisait les 4 créneaux ; le 429 envoyait alors vers `private.coffee`, muet
 * ce jour-là, et l'échec se lisait « AbortError » au bout de 25 s — la case de
 * « Fromagerie Collet » ne se chargeait jamais.
 */
async function politeAnswer(query: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<OsmResponse> {
  let lastError: unknown = new Error("Aucune instance Overpass configurée");
  for (const url of CONFIG.OVERPASS_URLS) {
    for (let attempt = 0; attempt < BUSY_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timer = setTimeout(abort, timeoutMs);
      signal?.addEventListener("abort", abort);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: query,
          signal: controller.signal,
        });
        // 429 : quota épuisé. 504 : « serveur trop occupé » (constaté le
        // 30 septembre 2026, au bout de 15 s). Dans les deux cas l'instance
        // répondra plus tard : on attend plutôt que de partir vers une autre,
        // muette ce jour-là.
        if (res.status === 429 || res.status === 504) throw new RateLimited(`Réponse ${res.status} de ${url}`);
        if (!res.ok) throw new Error(`Réponse ${res.status} de ${url}`);
        return (await res.json()) as OsmResponse;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        if (!(error instanceof RateLimited) || attempt === BUSY_ATTEMPTS - 1) break; // instance suivante
        // Le créneau annoncé, et au moins 2, 4 puis 8 s : un 504 dit « occupé »
        // alors que la page d'état annonce des créneaux libres.
        const wait = Math.min(Math.max(await slotWaitMs(url, signal), 2000 * 2 ** attempt), 30_000);
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
  }
  throw lastError;
}

/**
 * Les lieux nommés qui portent l'un de ces tags, dans une emprise
 * `[sud, ouest, nord, est]`. Sert à combler ce que les tuiles de la carte ne
 * transportent pas (`services/tileGaps.ts`) — une requête par déplacement,
 * pour quelques dizaines de valeurs, jamais la couche entière.
 */
export async function fetchTaggedPlaces(
  tags: Record<string, readonly string[]>,
  bbox: [number, number, number, number],
  signal?: AbortSignal,
  timeoutMs = CONFIG.OVERPASS_TIMEOUT_MS
): Promise<Place[]> {
  const area = bbox.map((value) => value.toFixed(5)).join(",");
  const parts = Object.entries(tags)
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => `nwr["${key}"~"^(${values.join("|")})$"]["name"](${area});`)
    .join("");
  const overpassQuery = `[out:json][timeout:20];(${parts});out center tags;`;
  const data = await politeAnswer(overpassQuery, signal, timeoutMs);
  const places: Place[] = [];
  for (const element of data.elements) {
    const place = elementToPlace(element);
    if (place?.group) places.push(place);
  }
  return places;
}

function detailsFromTags(tags: Record<string, string>): PlaceDetails {
  const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:postcode"], tags["addr:city"]]
    .filter(Boolean)
    .join(" ");
  return {
    address: address || undefined,
    openingHours: tags.opening_hours,
    phone: tags.phone ?? tags["contact:phone"],
    website: tags.website ?? tags["contact:website"],
    wikidata: tags.wikidata,
    wikipedia: tags.wikipedia,
  };
}

/**
 * Horaires, téléphone, site et adresse d'un lieu, à partir de son identifiant
 * `type/id` OSM. Rend `null` si le lieu est introuvable — et lève si aucune
 * source ne répond, auquel cas la fiche reste affichée, simplement sans ces
 * champs.
 */
export async function getPlaceDetails(id: string, signal?: AbortSignal): Promise<PlaceDetails | null> {
  const match = OSM_REF.exec(id);
  if (!match) return null;

  const cached = cache.get(id);
  if (cached) return cached;

  // Une zone téléchargée passe **devant le réseau**, et pas seulement quand il
  // manque : les détails sont déjà là, la fiche s'ouvre donc sans attendre
  // Overpass. C'est le bénéfice le plus visible du hors ligne en usage normal.
  const offline = await getOfflineDetails(id);
  if (offline) {
    cache.set(id, offline);
    return offline;
  }

  const [, type, osmId] = match;
  const query = `[out:json][timeout:10];${type}(${osmId});out tags 1;`;

  const overpass = (url: string) => (attemptSignal: AbortSignal) =>
    fetchJson(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: query }, attemptSignal);
  const osmApi = (attemptSignal: AbortSignal) =>
    fetchJson(`${CONFIG.OSM_API_URL}/${type}/${osmId}.json`, { method: "GET" }, attemptSignal);

  // L'ordre compte : Overpass reste la source de tête, mais l'API OSM vient
  // juste derrière plutôt qu'en fin de liste. Quand les instances publiques
  // limitent le débit — ce qui arrive vite en parcourant plusieurs commerces —
  // attendre qu'elles échouent toutes les quatre coûtait cinq secondes d'attente
  // sur la fiche, contre moins de deux ainsi.
  const [first, ...rest] = CONFIG.OVERPASS_URLS;
  const attempts = [overpass(first), osmApi, ...rest.map(overpass)];

  const data = await firstAnswer(attempts, signal);
  const tags = data.elements[0]?.tags;
  if (!tags) return null;

  const details = detailsFromTags(tags);
  cache.set(id, details);
  return details;
}
