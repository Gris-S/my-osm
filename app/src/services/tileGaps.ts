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

/** Cases par requête : une requête sur 8 cases z14 (6 × 3 km) dépassait le délai sur un serveur chargé. */
const CELLS_PER_REQUEST = 2;
/** Délai d'une requête : plus long que celui des détails d'un lieu, la zone est plus grande. */
const REQUEST_TIMEOUT_MS = 25000;

/**
 * Les lieux « hors tuiles » de la vue : mémoire, puis appareil, puis Overpass
 * pour les cases manquantes, **deux par deux en partant du centre de l'écran**.
 * `onProgress` reçoit ce qui est connu après chaque réponse : la carte se
 * remplit au fur et à mesure au lieu d'attendre la zone entière.
 */
export async function loadTileGaps(
  bbox: ViewBbox,
  signal?: AbortSignal,
  onProgress?: (places: Place[]) => void
): Promise<GapResult> {
  const cells = cellsFor(bbox); // déjà triées du centre vers le bord
  const places: Place[] = [];
  const missing: typeof cells = [];
  let failed = false;

  for (const cell of cells) {
    const key = tileKey(cell);
    const known = memory.get(key) ?? (await readPersistent<Place[]>(`gaps:v1:${key}`));
    if (known) {
      memory.set(key, known);
      places.push(...known);
    } else if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) {
      failed = true; // échec récent : on ne harcèle pas un serveur saturé
    } else {
      missing.push(cell);
    }
  }
  if (places.length) onProgress?.([...places]);

  for (let i = 0; i < missing.length && !signal?.aborted; i += CELLS_PER_REQUEST) {
    const batch = missing.slice(i, i + CELLS_PER_REQUEST);
    const bounds = batch.map(tileBounds);
    const area: [number, number, number, number] = [
      Math.min(...bounds.map((b) => b[1])),
      Math.min(...bounds.map((b) => b[0])),
      Math.max(...bounds.map((b) => b[3])),
      Math.max(...bounds.map((b) => b[2])),
    ];
    try {
      const found = (await fetchTaggedPlaces(TILE_GAP_TAGS, area, signal, REQUEST_TIMEOUT_MS)).map((place) => ({
        ...place,
        rank: RANK,
      }));
      batch.forEach((cell, index) => {
        const key = tileKey(cell);
        const mine = found.filter((place) => inCell(place, bounds[index]));
        memory.set(key, mine);
        failedAt.delete(key);
        void writePersistent(`gaps:v1:${key}`, mine, TTL_MS);
        places.push(...mine);
      });
      onProgress?.([...places]);
    } catch (error) {
      if (signal?.aborted) throw error;
      for (const cell of batch) failedAt.set(tileKey(cell), Date.now());
      // Pas de repli silencieux : l'appelant affiche que ces commerces manquent.
      console.warn("[carte] commerces hors tuiles indisponibles (Overpass) :", error);
      failed = true;
    }
  }
  return { places, failed };
}
