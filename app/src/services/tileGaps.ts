import type { Place } from "../types";
import { fetchTaggedPlaces } from "./overpass";
import { readPersistent, writePersistent } from "../transport/persistentCache";
import { tileBounds, tileKey, tilesForBbox, type ViewBbox } from "../transport/tiles";

// ---------------------------------------------------------------------------
// Ce que les tuiles de la carte ne transportent pas.
//
// Les commerces de la carte sont lus dans les tuiles d'OpenFreeMap (schéma
// OpenMapTiles), et ce schéma ne garde qu'une **liste fermée** de valeurs par
// clé. Constaté le 30 septembre 2026 : « Fromagerie Collet » (shop=cheese,
// dans OSM depuis 2013) absente de la carte ; sur six tuiles du centre de
// Paris, 613 boulangeries mais **zéro** fromagerie, pâtisserie, poissonnerie,
// épicerie, salle de sport, mémorial. La liste de référence est
// `layers/poi/mapping.yaml` du dépôt openmaptiles/openmaptiles.
//
// `TILE_GAP_TAGS` est la différence entre ce que `filters.ts` énumère et cette
// liste : ces valeurs-là, et elles seules, sont demandées à Overpass pour la
// vue, puis mêlées aux lieux des tuiles — même pastille, même filtre, même
// fiche. Un lieu déjà présent dans les tuiles a le même identifiant
// (`node/…`) : il n'apparaît pas deux fois.
//
// **Overpass est fragile** (mesuré le même jour : le serveur principal
// « trop occupé » au bout de 13 s, le second muet). D'où une case gardée
// sept jours sur l'appareil : ce qui a été vu une fois reste affiché, et un
// échec ne se retente qu'au bout d'une minute — et se dit (`failed`).
// ---------------------------------------------------------------------------

export const TILE_GAP_TAGS: Record<string, readonly string[]> = {
  shop: [
    "appliance",
    "cheese",
    "curtain",
    "dairy",
    "electrical",
    "fashion_accessories",
    "flooring",
    "grocery",
    "health_food",
    "herbalist",
    "houseware",
    "kitchen",
    "leather",
    "lighting",
    "medical_supply",
    "nuts",
    "pastry",
    "seafood",
    "sewing",
    "spices",
    "tea",
    "tiles",
    "trade",
  ],
  amenity: ["bureau_de_change", "car_rental", "casino", "music_venue"],
  leisure: [
    "common",
    "fitness_centre",
    "fitness_station",
    "horse_riding",
    "nature_reserve",
    "sauna",
    "spa",
    "sports_hall",
    "track",
  ],
  historic: ["archaeological_site", "memorial"],
  natural: ["beach"],
  tourism: ["apartment"],
};

/**
 * Taille d'une case : une tuile z14, ~1,6 km de côté à Paris. Au zoom 14 —
 * celui d'ouverture de la carte — un écran de téléphone en couvre 8 ; au 15,
 * 2. Au-dessous du 14, la carte ne montre de toute façon plus les commerces.
 */
export const GAP_CELL_ZOOM = 14;
export const GAP_MIN_ZOOM = 14;
const MAX_CELLS = 9;
const TTL_MS = 7 * 24 * 3600 * 1000;
const RETRY_MS = 60 * 1000;
const RANK = 150;

const memory = new Map<string, Place[]>();
const failedAt = new Map<string, number>();

function cellsFor(bbox: ViewBbox) {
  return tilesForBbox(bbox, GAP_CELL_ZOOM).slice(0, MAX_CELLS);
}

/** Les cases que demanderait cette vue : si elles n'ont pas changé, rien à refaire. */
export function gapCellsKey(bbox: ViewBbox): string {
  return cellsFor(bbox).map(tileKey).join(",");
}

function inCell(place: Place, bounds: [number, number, number, number]): boolean {
  const [west, south, east, north] = bounds;
  return place.lon >= west && place.lon < east && place.lat >= south && place.lat < north;
}

export interface GapResult {
  places: Place[];
  /** Vrai si une partie de la vue n'a pas pu être demandée : l'interface le dit. */
  failed: boolean;
}

/**
 * Cases par requête : 4 cases z14 (~3 × 3 km) répondent en ~6 s (mesuré sur le
 * téléphone). Les découper davantage épuisait les 4 créneaux par adresse IP
 * d'overpass-api.de — c'était ça, et non un délai trop court, qui laissait
 * la case de « Fromagerie Collet » vide.
 */
const CELLS_PER_REQUEST = 4;
/** Délai d'une requête : plus long que celui des détails d'un lieu, la zone est plus grande. */
const REQUEST_TIMEOUT_MS = 25000;

/**
 * Les demandes en cours, par case, et la file qui les fait passer **une à la
 * fois**.
 *
 * Une demande Overpass n'est **jamais annulée** : le serveur la calcule
 * jusqu'au bout même si le navigateur raccroche, et elle occupe l'un des
 * 4 créneaux de l'adresse IP. Constaté sur la version Docker : la vue de
 * départ, le vol vers un résultat puis trois crans de zoom lançaient chacun une
 * demande en annulant la précédente — quatre requêtes vivantes côté serveur,
 * et un 429 dès la première visite de la rue du Midi. Désormais une case déjà
 * demandée est **attendue**, pas redemandée, et le résultat d'une vue quittée
 * sert quand même (il est rangé pour sept jours).
 */
const inflight = new Map<string, Promise<Place[] | null | undefined>>();

/**
 * La file : la demande **la plus récente passe d'abord** (la vue qu'on
 * regarde), une seule à la fois, et une demande pas encore partie dont aucune
 * case n'est plus à l'écran est abandonnée avant de partir (`undefined` : ni
 * chargée ni en échec, elle sera redemandée si on y revient). Sans cela, les
 * cases de la vue d'ouverture passaient avant celle du résultat qu'on venait
 * d'ouvrir (constaté : trois requêtes sur Paris avant la rue du Midi).
 */
interface Job {
  keys: string[];
  area: [number, number, number, number];
  settle: (found: Place[] | null | undefined) => void;
}
const jobs: Job[] = [];
let busy = false;
let wanted = new Set<string>();

function pump(): void {
  if (busy) return;
  let job = jobs.pop();
  while (job && !job.keys.some((key) => wanted.has(key))) {
    job.settle(undefined);
    job = jobs.pop();
  }
  if (!job) return;
  busy = true;
  const current = job;
  fetchTaggedPlaces(TILE_GAP_TAGS, current.area, undefined, REQUEST_TIMEOUT_MS)
    .then(
      (found) => current.settle(found),
      (error: unknown) => {
        // Pas de repli silencieux : l'appelant affiche que ces commerces manquent.
        console.warn("[carte] commerces hors tuiles indisponibles (Overpass) :", error);
        current.settle(null);
      }
    )
    .finally(() => {
      busy = false;
      pump();
    });
}

function requestBatch(batch: ReturnType<typeof cellsFor>): void {
  const bounds = batch.map(tileBounds);
  const area: [number, number, number, number] = [
    Math.min(...bounds.map((b) => b[1])),
    Math.min(...bounds.map((b) => b[0])),
    Math.max(...bounds.map((b) => b[3])),
    Math.max(...bounds.map((b) => b[2])),
  ];
  const keys = batch.map(tileKey);
  let settle!: (found: Place[] | null | undefined) => void;
  const outcome = new Promise<Place[] | null | undefined>((resolve) => (settle = resolve));
  keys.forEach((key, index) => {
    const mine = outcome
      .then((found) => {
        if (found === undefined) return undefined; // abandonnée avant de partir
        if (found === null) {
          failedAt.set(key, Date.now());
          return null;
        }
        const places = found.filter((place) => inCell(place, bounds[index])).map((place) => ({ ...place, rank: RANK }));
        memory.set(key, places);
        failedAt.delete(key);
        void writePersistent(`gaps:v1:${key}`, places, TTL_MS);
        return places;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, mine);
  });
  jobs.push({ keys, area, settle });
}

/**
 * Les lieux « hors tuiles » de la vue : mémoire, puis appareil, puis Overpass
 * pour les cases ni connues ni déjà demandées, **quatre par requête en partant
 * du centre de l'écran**. `onProgress` reçoit ce qui est connu après chaque
 * case arrivée : la carte se remplit au fur et à mesure. `signal` ne fait que
 * cesser d'attendre — la demande, elle, va au bout (voir `inflight`).
 */
export async function loadTileGaps(
  bbox: ViewBbox,
  signal?: AbortSignal,
  onProgress?: (places: Place[]) => void
): Promise<GapResult> {
  const cells = cellsFor(bbox); // déjà triées du centre vers le bord
  wanted = new Set(cells.map(tileKey));
  const places: Place[] = [];
  const missing: typeof cells = [];
  const pending: Promise<Place[] | null | undefined>[] = [];
  let failed = false;

  for (const cell of cells) {
    const key = tileKey(cell);
    const known = memory.get(key) ?? (await readPersistent<Place[]>(`gaps:v1:${key}`));
    if (known) {
      memory.set(key, known);
      places.push(...known);
    } else if (inflight.has(key)) {
      pending.push(inflight.get(key)!);
    } else if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) {
      failed = true; // échec récent : on ne harcèle pas un serveur saturé
    } else {
      missing.push(cell);
    }
  }
  if (places.length) onProgress?.([...places]);

  // Poussées du bord vers le centre : la file sert la dernière d'abord, donc
  // les cases du centre de l'écran.
  const batches: (typeof cells)[] = [];
  for (let i = 0; i < missing.length; i += CELLS_PER_REQUEST) batches.push(missing.slice(i, i + CELLS_PER_REQUEST));
  for (const batch of batches.reverse()) requestBatch(batch);
  pump();
  for (const cell of missing) pending.push(inflight.get(tileKey(cell))!);

  for (const wait of pending) {
    const result = await wait;
    if (signal?.aborted) return { places, failed };
    if (result === null) failed = true;
    else if (result?.length) {
      places.push(...result);
      onProgress?.([...places]);
    }
  }
  return { places, failed };
}
