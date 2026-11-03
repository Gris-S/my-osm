import type { Map as MLMap } from "maplibre-gl";

// ---------------------------------------------------------------------------
// L'endroit que la carte montre, pour la recherche (demande explicite du
// 3 novembre 2026) : à Paris et regardant Lyon, « pharmacie » doit trouver les
// pharmacies de Lyon. `MapView` déclare sa carte ; la recherche lit le centre
// et le zoom **au moment où elle part**, sans rendu de plus à chaque
// déplacement. Un magasin de module, comme la langue : la carte et la barre
// de recherche sont loin l'une de l'autre dans l'arbre, et `App` n'a pas de
// contexte.
// ---------------------------------------------------------------------------

let current: MLMap | null = null;

export function setSearchMap(map: MLMap | null): void {
  current = map;
}

/** Le centre et le zoom affichés, ou `null` avant que la carte existe. */
export function mapFocus(): { lon: number; lat: number; zoom: number } | null {
  if (!current) return null;
  try {
    const { lng, lat } = current.getCenter();
    return { lon: lng, lat, zoom: current.getZoom() };
  } catch {
    return null; // carte en cours de destruction
  }
}
