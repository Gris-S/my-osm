import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CONFIG } from "../config";
import { distance } from "../navigation/geo";
import type { LonLat } from "../types";
import { loadBikeStations, type BikeStation } from "./bikes";
import { loadChargers, loadFuelStations, type Charger, type FuelStation } from "./fuel";
import { applyLive, type LiveLayers } from "./layers";
import { useFuelType, useShowingChargers } from "./settings";

// ---------------------------------------------------------------------------
// Ce que la carte montre des modes en direct, et quand elle le redemande.
//
// Relu 400 ms après le dernier déplacement, puis toutes les deux minutes tant
// que la couche est là (la cadence du cache des vélos). En deçà de
// `LIVE_MIN_ZOOM`, rien n'est demandé et les repères s'effacent : la zone
// serait trop grande pour un service public, et la carte illisible.
// ---------------------------------------------------------------------------

/** Ce qu'on peut toucher sur la carte, avec tout ce que sa fiche affiche. */
export type LiveItem =
  | { kind: "bike"; station: BikeStation }
  | { kind: "fuel"; station: FuelStation }
  | { kind: "charger"; charger: Charger };

const NOTHING: LiveLayers = { bikes: null, fuel: null, chargers: null };

// Les repères affichés, pour la recherche : elle propose les plus proches sans
// rien redemander. Une seule carte dans l'application, donc une seule liste.
let shownItems: LiveItem[] = [];
const itemListeners = new Set<() => void>();

function publishItems(next: LiveItem[]) {
  shownItems = next;
  for (const listener of itemListeners) listener();
}

const currentLiveItems = (): LiveItem[] => shownItems;

/** Les stations, stations-service et bornes actuellement sur la carte. */
export function useLiveItems(): LiveItem[] {
  return useSyncExternalStore(
    (listener) => {
      itemListeners.add(listener);
      return () => {
        itemListeners.delete(listener);
      };
    },
    currentLiveItems,
    currentLiveItems,
  );
}

/** L'enseigne d'OpenStreetMap est cherchée à cette distance d'une station sans nom. */
const BRAND_METERS = 150;

export function useLiveLayer(
  mapRef: RefObject<MLMap | null>,
  show: { bikes: boolean; fuel: boolean },
  /** Les stations-service des tuiles, avec leur nom : l'enseigne vient de là. */
  fuelPoisRef: RefObject<{ lon: number; lat: number; name: string }[]>,
) {
  const fuelType = useFuelType();
  const chargers = useShowingChargers();
  /** Ce qui est posé sur la carte, pour le reposer après un changement de style. */
  const shownRef = useRef<LiveLayers>(NOTHING);
  /** Les repères affichés, par identifiant : la fiche s'ouvre sur l'objet entier. */
  const itemsRef = useRef(new Map<string, LiveItem>());

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // `isStyleLoaded` reste faux tant que des tuiles arrivent (constaté après
    // un zoom : les repères n'étaient jamais posés) — on attend alors `idle`.
    const applyNow = () => applyLive(map, shownRef.current);
    const put = (next: LiveLayers) => {
      shownRef.current = next;
      if (map.isStyleLoaded()) applyNow();
      else {
        map.off("idle", applyNow);
        map.once("idle", applyNow);
      }
    };
    if (!show.bikes && !show.fuel) {
      itemsRef.current = new Map();
      if (shownItems.length) publishItems([]);
      put(NOTHING);
      return;
    }

    let cancelled = false;
    let timer = 0;
    const controller = new AbortController();

    const brandNear = (at: LonLat): string | null => {
      let best: { name: string; meters: number } | null = null;
      for (const poi of fuelPoisRef.current) {
        const meters = distance(at, poi);
        if (meters <= BRAND_METERS && (!best || meters < best.meters)) best = { name: poi.name, meters };
      }
      return best?.name ?? null;
    };

    async function refresh() {
      if (!map || map.getZoom() < CONFIG.LIVE_MIN_ZOOM) {
        put(NOTHING);
        return;
      }
      const b = map.getBounds();
      const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const wantChargers = show.fuel && chargers;
      const wantFuel = show.fuel && !chargers && fuelType !== "ev";
      const [bikes, fuel, points] = await Promise.all([
        show.bikes ? loadBikeStations(bbox).catch((): BikeStation[] => []) : null,
        wantFuel ? loadFuelStations(bbox, fuelType, controller.signal).catch((): FuelStation[] => []) : null,
        wantChargers ? loadChargers(bbox, controller.signal).catch((): Charger[] => []) : null,
      ]);
      if (cancelled) return;
      for (const s of fuel ?? []) s.brand ??= brandNear(s);
      const items = new Map<string, LiveItem>();
      for (const station of bikes ?? []) items.set(station.id, { kind: "bike", station });
      for (const station of fuel ?? []) items.set(station.id, { kind: "fuel", station });
      for (const charger of points ?? []) items.set(charger.id, { kind: "charger", charger });
      itemsRef.current = items;
      publishItems([...items.values()]);
      put({
        bikes,
        fuel: fuel && fuelType !== "ev" ? { stations: fuel, fuel: fuelType } : null,
        chargers: points,
      });
    }

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 400);
    };
    void refresh();
    map.on("moveend", schedule);
    const clock = window.setInterval(() => void refresh(), CONFIG.BIKES_TTL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
      window.clearInterval(clock);
      map.off("moveend", schedule);
      map.off("idle", applyNow);
    };
  }, [mapRef, fuelPoisRef, show.bikes, show.fuel, fuelType, chargers]);

  return { shownRef, itemsRef };
}
