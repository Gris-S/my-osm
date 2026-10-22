import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Les réglages des deux modes « en direct » (Réglages › Modes) : vélos en
// libre-service, carburants et recharge. **Éteints par défaut** : chacun
// envoie la zone affichée à un service tiers, et rien ne part sans accord.
//
// Même patron que les autres réglages (clé `osm-local:*`, lecture tolérante aux
// pannes) et un magasin de module, comme ceux de la navigation : la carte, la
// recherche, le menu des calques et la fenêtre « Modes » les lisent tous, et
// `App` n'a pas de contexte.
// ---------------------------------------------------------------------------

/**
 * Le carburant de l'utilisateur. Il décide de ce que montre la ligne
 * « Carburant » des calques : le prix de ce carburant, ou les bornes de
 * recharge pour `ev` (demande explicite : un seul calque, qui suit ce choix).
 */
export type FuelType = "gazole" | "e10" | "sp95" | "sp98" | "e85" | "gplc" | "ev";

export const FUEL_TYPES: readonly FuelType[] = ["gazole", "e10", "sp95", "sp98", "e85", "gplc", "ev"];

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // localStorage indisponible (mode privé, etc.)
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore : le choix restera simplement non persisté */
  }
}

function booleanSetting(key: string, fallback: boolean) {
  const stored = readStored(key);
  let value = stored === "on" ? true : stored === "off" ? false : fallback;
  const get = () => value;
  function set(next: boolean) {
    writeStored(key, next ? "on" : "off");
    value = next;
    notify();
  }
  const useValue = () => useSyncExternalStore(subscribe, get, get);
  return { get, set, useValue };
}

const bikes = booleanSetting("osm-local:live-bikes", false);
const fuel = booleanSetting("osm-local:live-fuel", false);
// La ligne des calques : allumée d'office dès que le mode l'est, éteinte à la main.
const fuelLayer = booleanSetting("osm-local:live-fuel-layer", true);

/** Vélos en libre-service : affichés avec la catégorie Transports, et dans la recherche. */
export const bikesModeEnabled = bikes.get;
export const setBikesModeEnabled = bikes.set;
export const useBikesModeEnabled = bikes.useValue;

/** Carburants et recharge : la ligne des calques, et la recherche. */
export const fuelModeEnabled = fuel.get;
export const setFuelModeEnabled = fuel.set;
export const useFuelModeEnabled = fuel.useValue;

export const fuelLayerOn = fuelLayer.get;
export const setFuelLayerOn = fuelLayer.set;
export const useFuelLayerOn = fuelLayer.useValue;

const FUEL_KEY = "osm-local:live-fuel-type";
// SP95-E10 par défaut : le carburant le plus vendu en France.
const storedFuel = readStored(FUEL_KEY) as FuelType | null;
let fuelType: FuelType = storedFuel && FUEL_TYPES.includes(storedFuel) ? storedFuel : "e10";

export const currentFuelType = () => fuelType;

export function setFuelType(next: FuelType) {
  writeStored(FUEL_KEY, next);
  fuelType = next;
  chargersAsked = false;
  notify();
}

export const useFuelType = () => useSyncExternalStore(subscribe, currentFuelType, currentFuelType);

// « Afficher toutes les bornes de recharge » depuis la recherche, sans changer
// de carburant : le calque montre les bornes jusqu'au prochain choix. Le temps
// de la session seulement — rouverte, l'application revient à son carburant.
let chargersAsked = false;

export function setChargersShown(next: boolean) {
  chargersAsked = next;
  notify();
}

/** Le calque montre-t-il les bornes plutôt que des prix ? */
export const showingChargers = () => fuelType === "ev" || chargersAsked;
export const useShowingChargers = () => useSyncExternalStore(subscribe, showingChargers, showingChargers);
