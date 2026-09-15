import { useCallback, useRef, useState } from "react";
import { searchBrandPlaces } from "../services/overpass";
import type { Place } from "../types";

// ---------------------------------------------------------------------------
// La recherche d'enseigne : « afficher tous les … » dans l'emprise visible.
// Sorti d'`App` sans rien changer.
// ---------------------------------------------------------------------------

export function useBrandSearch() {
  // Recherche d'enseigne : la carte n'affiche plus que les lieux dont le nom
  // correspond, quelles que soient les catégories cochées — celles-ci sont
  // conservées telles quelles et reprennent la main à la sortie.
  const [brand, setBrand] = useState<string | null>(null);
  const [brandPlaces, setBrandPlaces] = useState<Place[] | null>(null);
  const [brandComplete, setBrandComplete] = useState(true);
  const [brandFailed, setBrandFailed] = useState(false);
  const [brandStale, setBrandStale] = useState(false);
  const [brandLoading, setBrandLoading] = useState(false);

  // L'emprise visible, tenue par une ref : la recherche d'enseigne porte sur ce
  // qu'on voit, sans que chaque déplacement de carte provoque un rendu.
  const viewportRef = useRef<[number, number, number, number] | null>(null);
  const handleViewportChange = useCallback((bbox: [number, number, number, number]) => {
    viewportRef.current = bbox;
  }, []);

  const runBrandSearch = useCallback(async (query: string) => {
    const bbox = viewportRef.current;
    if (!bbox) return;
    setBrand(query);
    setBrandStale(false);
    setBrandLoading(true);
    setBrandFailed(false);
    try {
      const { places, complete } = await searchBrandPlaces(query, bbox);
      setBrandPlaces(places);
      setBrandComplete(complete);
    } catch {
      // Un service injoignable n'est pas une absence de magasins : le bandeau
      // doit dire l'un et pas l'autre.
      setBrandPlaces([]);
      setBrandFailed(true);
    } finally {
      setBrandLoading(false);
    }
  }, []);

  const handleBrandStale = useCallback(() => setBrandStale(true), []);

  const closeBrand = useCallback(() => {
    setBrand(null);
    setBrandPlaces(null);
    setBrandStale(false);
  }, []);

  return { brand, brandPlaces, brandComplete, brandFailed, brandStale, brandLoading, handleViewportChange, runBrandSearch, handleBrandStale, closeBrand };
}
