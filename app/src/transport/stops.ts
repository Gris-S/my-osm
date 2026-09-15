import type { Place } from "../types";
import { isAbortError } from "./abort";
import { transport } from "./index";
import type { Station } from "./model";
import { TRANSITOUS_STOPS } from "./policy";
import { dedupeStations, stationToPlace } from "./stopsMerge";
import { tileKey, tilesForBbox, type ViewBbox } from "./tiles";

// ---------------------------------------------------------------------------
// Les arrêts d'une vue, hors des tuiles d'OSM.
//
// La carte dessine d'abord les arrêts des tuiles vectorielles, sans attendre ;
// ceux-ci les complètent là où la région a une source d'arrêts (capacité
// `stops` du registre — pas en Île-de-France, où OSM et IDFM suffisent et où le
// budget de requêtes est mesuré). Une requête par tuile z15, trois tuiles au
// plus par vue, les plus proches du centre d'abord.
// ---------------------------------------------------------------------------

/** Les tuiles que demanderait cette vue : si elles n'ont pas changé, rien à redemander. */
export function stopTilesKey(bbox: ViewBbox): string {
  return tilesForBbox(bbox, TRANSITOUS_STOPS.tileZoom)
    .slice(0, TRANSITOUS_STOPS.maxTilesPerView)
    .map(tileKey)
    .join(",");
}

export async function loadStopsInView(bbox: ViewBbox, signal?: AbortSignal): Promise<Place[]> {
  const [south, west, north, east] = bbox;
  const orchestrator = transport();
  orchestrator.updatePosition((west + east) / 2, (south + north) / 2);
  const tiles = tilesForBbox(bbox, TRANSITOUS_STOPS.tileZoom).slice(0, TRANSITOUS_STOPS.maxTilesPerView);
  const perTile = await Promise.all(
    tiles.map((tile) =>
      orchestrator
        .run("stops", (provider, attemptSignal) => provider.getStopsInViewport?.(tile, attemptSignal), signal)
        .then((result): Station[] => result.value)
        .catch((error): Station[] => {
          if (isAbortError(error)) throw error;
          // Une tuile qui ne répond pas n'empêche pas les autres de s'afficher.
          return [];
        })
    )
  );
  return dedupeStations(perTile.flat()).map(stationToPlace);
}
