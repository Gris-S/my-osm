import { useEffect, useMemo, useState } from "react";
import { CONFIG } from "../config";
import { searchPlacesDetailed } from "../services/geocode";
import { fetchTaggedPlaces } from "../services/overpass";
import { searchSeenPois } from "../services/tilePois";
import { currentDictionaries, loadDictionaries, matchCategory, type CategoryMatch } from "../search/dictionaries";
import { mapFocus } from "../search/mapFocus";
import { proximityScale, rankResults, type LocalMatch } from "../search/rank";
import { textScore } from "../search/textMatch";
import type { LonLat, Place } from "../types";

// ---------------------------------------------------------------------------
// Recherche de lieux et d'adresses. Partagée par la barre de recherche
// principale et les champs d'itinéraire. Trois sources, fondues par
// `rankResults` :
//
// 1. **les lieux de la carte**, à chaque lettre et sans réseau
//    (`searchSeenPois`) — la liste ne reste jamais vide une seconde ;
// 2. **Photon**, 150 ms après la dernière lettre, réponses gardées en mémoire ;
// 3. pour une **catégorie** tapée en entier (« pharmacie »), OpenStreetMap
//    autour du point regardé (Overpass) : les lieux dont le nom ne dit pas la
//    catégorie.
//
// `followMap` : chercher autour de ce que la carte **montre** (demande
// explicite du 3 novembre 2026 — à Paris, regardant Lyon, on cherche à Lyon),
// et non autour de `near`. Les champs d'itinéraire gardent `near`.
// ---------------------------------------------------------------------------

interface Focus extends LonLat {
  zoom: number;
}

interface Remote {
  query: string;
  places: Place[];
  degraded: boolean;
}

/** Réponses de Photon déjà reçues, par saisie et endroit (plus ancienne évincée d'abord). */
const cache = new Map<string, { at: number; places: Place[] }>();
function cached(key: string): Place[] | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CONFIG.SEARCH_CACHE_TTL_MS) return null;
  cache.delete(key);
  cache.set(key, hit); // revu : passe en fin de file
  return hit.places;
}
function store(key: string, places: Place[]): void {
  cache.set(key, { at: Date.now(), places });
  if (cache.size > CONFIG.SEARCH_CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Emprise `[sud, ouest, nord, est]` d'un carré de `meters` de demi-côté. */
function bboxAround({ lon, lat }: LonLat, meters: number): [number, number, number, number] {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

export function usePlaceSearch(query: string, near?: LonLat, { followMap = false }: { followMap?: boolean } = {}) {
  const typed = query.trim() !== "";
  const nearLat = near?.lat ?? CONFIG.DEFAULT_CENTER.lat;
  const nearLon = near?.lon ?? CONFIG.DEFAULT_CENTER.lon;

  const [dict, setDict] = useState(currentDictionaries);
  useEffect(() => {
    if (!dict) loadDictionaries().then(setDict, () => {});
  }, [dict]);

  // Ce qui est calculé à chaque lettre, pendant le rendu : l'endroit — relu à
  // chaque saisie, la carte a pu bouger depuis —, la catégorie, et les lieux de
  // la carte (quelques millisecondes, sans réseau).
  const instant = useMemo((): { query: string; focus: Focus; category: CategoryMatch | null; local: LocalMatch[] } | null => {
    if (!typed) return null;
    const view = followMap ? mapFocus() : null;
    const focus: Focus = view ?? { lon: nearLon, lat: nearLat, zoom: CONFIG.DEFAULT_ZOOM };
    const category = dict ? matchCategory(dict, query) : null;
    const local = searchSeenPois(query, focus, { category: category?.value, categoryText: category?.exact ? 1 : 0.75, maxMeters: 6 * proximityScale(focus.zoom) });
    return { query, focus, category, local };
  }, [query, typed, nearLon, nearLat, followMap, dict]);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [around, setAround] = useState<{ query: string; places: Place[] } | null>(null);

  useEffect(() => {
    if (!instant) return;
    const { focus, category } = instant;
    const scale = proximityScale(focus.zoom);

    // Chaque saisie interrompt la recherche de la précédente : une réponse lente
    // à « gare de ly » ne peut plus arriver après celle à « gare de lyon » et
    // l'écraser.
    const controller = new AbortController();
    const exact = category?.exact ? category : null;
    const key = [query.trim().toLowerCase(), focus.lat.toFixed(2), focus.lon.toFixed(2), Math.round(focus.zoom), exact?.value ?? ""].join("|");
    const hit = cached(key);
    const timer = window.setTimeout(
      async () => {
        if (hit) {
          setRemote({ query, places: hit, degraded: false });
        } else {
          try {
            const { places, degraded } = await searchPlacesDetailed(query, focus, controller.signal, { zoom: focus.zoom, category: exact });
            if (controller.signal.aborted) return;
            if (!degraded) store(key, places);
            setRemote({ query, places, degraded });
          } catch {
            if (!controller.signal.aborted) setRemote({ query, places: [], degraded: true });
          }
        }
        // Une catégorie entière : ses lieux autour du point regardé, même sans le mot dans leur nom.
        if (exact && !controller.signal.aborted) {
          const meters = Math.min(CONFIG.SEARCH_CATEGORY_MAX_METERS, Math.max(CONFIG.SEARCH_CATEGORY_MIN_METERS, scale));
          fetchTaggedPlaces({ [exact.key]: [exact.value] }, bboxAround(focus, meters), controller.signal, CONFIG.SEARCH_CATEGORY_TIMEOUT_MS).then(
            (places) => !controller.signal.aborted && setAround({ query, places }),
            () => {} // Overpass occupé : les lieux de la carte et Photon suffisent
          );
        }
      },
      hit ? 0 : CONFIG.SEARCH_DEBOUNCE_MS
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [instant, query]);

  const results = useMemo(() => {
    if (!instant) return [];
    // Pendant qu'on tape, la réponse de la saisie précédente reste, filtrée sur
    // la nouvelle (« boula » → « boulang ») : la liste ne clignote pas.
    const remotePlaces = !remote ? null : remote.query === query ? remote.places : remote.places.filter((p) => textScore(query, p.name) >= 0.5);
    const exact = instant.category?.exact ? instant.category : null;
    return rankResults({
      query,
      focus: instant.focus,
      zoom: instant.focus.zoom,
      local: instant.local,
      remote: remotePlaces,
      category: exact ? { value: exact.value, places: around?.query === query ? around.places : [] } : null,
    });
  }, [instant, remote, around, query]);

  return {
    results,
    loading: typed && remote?.query !== query,
    /** Photon n'a pas répondu : seules des adresses et les lieux de la carte sont proposés. */
    degraded: typed && remote?.query === query && remote.degraded,
    /** Catégories et enseignes connues (`search/dictionaries.ts`), `null` tant qu'elles chargent. */
    dictionaries: dict,
  };
}
