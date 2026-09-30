import { useEffect, useState } from "react";
import { CONFIG } from "../config";
import { searchPlacesDetailed } from "../services/geocode";
import type { LonLat, Place } from "../types";

// ---------------------------------------------------------------------------
// Recherche de lieux/adresses (Photon) avec anti-rebond. Partagée par la barre
// de recherche principale et le sélecteur de point de départ d'itinéraire.
// Renvoie une liste vide tant que la saisie est vide.
// ---------------------------------------------------------------------------

export function usePlaceSearch(query: string, near?: LonLat) {
  // La dernière réponse, **avec la saisie qui l'a demandée**.
  const [answer, setAnswer] = useState<{ query: string; results: Place[]; degraded: boolean } | null>(null);
  const lat = near?.lat ?? CONFIG.DEFAULT_CENTER.lat;
  const lon = near?.lon ?? CONFIG.DEFAULT_CENTER.lon;
  const typed = query.trim() !== "";

  useEffect(() => {
    if (!typed) return;
    // Chaque saisie interrompt la recherche de la précédente : une réponse lente
    // à « gare de ly » ne peut plus arriver après celle à « gare de lyon » et
    // l'écraser.
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const { places: found, degraded } = await searchPlacesDetailed(query, { lon, lat }, controller.signal);
        if (controller.signal.aborted) return;
        // Photon renvoie parfois plusieurs entrées pour le même objet OSM.
        const seen = new Set<string>();
        setAnswer({
          query,
          degraded,
          results: found.filter((p) => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
          }),
        });
      } catch {
        if (!controller.signal.aborted) setAnswer({ query, results: [], degraded: true });
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, typed, lon, lat]);

  // Les résultats précédents restent affichés pendant qu'on tape — la liste ne
  // clignote pas à chaque lettre — et le chargement dure jusqu'à la réponse
  // de la saisie en cours.
  return {
    results: typed && answer ? answer.results : [],
    loading: typed && answer?.query !== query,
    /** Le moteur des commerces n'a pas répondu : seules des adresses sont proposées. */
    degraded: typed && answer?.query === query && answer.degraded,
  };
}
