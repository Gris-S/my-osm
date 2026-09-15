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

export type PlaceDetails = Pick<Place, "address" | "openingHours" | "phone" | "website">;

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
async function fetchJson(url: string, init: RequestInit, signal: AbortSignal): Promise<OsmResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, CONFIG.OVERPASS_TIMEOUT_MS);
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
    rawType: tags.shop ?? tags.amenity ?? tags.leisure ?? tags.tourism,
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

function detailsFromTags(tags: Record<string, string>): PlaceDetails {
  const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:postcode"], tags["addr:city"]]
    .filter(Boolean)
    .join(" ");
  return {
    address: address || undefined,
    openingHours: tags.opening_hours,
    phone: tags.phone ?? tags["contact:phone"],
    website: tags.website ?? tags["contact:website"],
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
