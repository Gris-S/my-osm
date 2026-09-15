import { useSyncExternalStore } from "react";
import { hasAmbientLightPlugin, watchBrightness } from "../services/ambientLight";

// ---------------------------------------------------------------------------
// Gestion du thème clair / sombre.
//
// Trois réglages : « Automatique », « Clair », « Sombre ».
//
// - **Automatique** est le défaut, et l'absence de choix : aucune clé en
//   `localStorage`. Sur téléphone (APK), le thème suit la **lumière ambiante**
//   mesurée par le capteur — sombre la nuit ou dans un tunnel, clair au jour
//   (voir `services/ambientLight.ts`). Sans capteur — un navigateur, un
//   appareil qui n'en a pas — il suit le thème de l'appareil
//   (`prefers-color-scheme`).
// - **Clair** et **Sombre** sont mémorisés et prennent le pas sur tout le
//   reste. Revenir à « Automatique » efface la clé.
// - Le thème actif est reflété par l'attribut `data-theme` sur `<html>`, ce sur
//   quoi s'appuie le CSS.
//
// C'est un **magasin de module** et non un `useState` : le thème est lu à deux
// endroits éloignés de l'arbre (`App` et l'historique des trajets), et deux
// états indépendants démarreraient chacun leur capteur et pourraient se
// contredire. Même raison que pour la langue. Le capteur n'écoute que tant
// qu'un composant est abonné et que le réglage est « Automatique ».
// ---------------------------------------------------------------------------

export type Theme = "light" | "dark";
export type ThemeMode = Theme | "auto";
/** D'où vient le thème automatique : le capteur de lumière, ou l'appareil. */
export type AutoSource = "sensor" | "system";

interface ThemeSnapshot {
  theme: Theme;
  mode: ThemeMode;
  autoSource: AutoSource;
}

const STORAGE_KEY = "osm-local:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto"; // localStorage indisponible (mode privé, etc.)
  }
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

let mode: ThemeMode = readStoredMode();
// Point de départ du thème automatique : celui de l'appareil, en attendant le
// premier relevé du capteur (quelques dizaines de millisecondes).
let autoTheme: Theme = systemTheme();
let autoSource: AutoSource = hasAmbientLightPlugin() ? "sensor" : "system";
let snapshot: ThemeSnapshot = compute();
const listeners = new Set<() => void>();
let stopAuto: (() => void) | null = null;

document.documentElement.dataset.theme = snapshot.theme;

function compute(): ThemeSnapshot {
  return { theme: mode === "auto" ? autoTheme : mode, mode, autoSource };
}

function publish() {
  const next = compute();
  if (next.theme === snapshot.theme && next.mode === snapshot.mode && next.autoSource === snapshot.autoSource) return;
  snapshot = next;
  document.documentElement.dataset.theme = next.theme;
  listeners.forEach((listener) => listener());
}

function startAuto() {
  if (stopAuto) return;
  const query = window.matchMedia(DARK_QUERY);
  const onSystemChange = (event: MediaQueryListEvent) => {
    if (autoSource !== "system") return;
    autoTheme = event.matches ? "dark" : "light";
    publish();
  };
  query.addEventListener("change", onSystemChange);
  const stopSensor = watchBrightness(
    (brightness) => {
      autoSource = "sensor";
      autoTheme = brightness;
      publish();
    },
    () => {
      autoSource = "system";
      autoTheme = systemTheme();
      publish();
    }
  );
  stopAuto = () => {
    query.removeEventListener("change", onSystemChange);
    stopSensor();
    stopAuto = null;
  };
}

/** Le capteur n'écoute que si le réglage est automatique et que quelqu'un regarde. */
function syncAuto() {
  if (mode === "auto" && listeners.size > 0) startAuto();
  else stopAuto?.();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  syncAuto();
  return () => {
    listeners.delete(listener);
    syncAuto();
  };
}

/** Choix manuel d'un thème : mémorisé, il prend le pas sur la lumière et l'appareil. */
function setTheme(next: Theme) {
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore : le thème restera simplement non persisté */
  }
  syncAuto();
  publish();
}

/** Revient au thème automatique, et oublie le choix manuel. */
function setAutoTheme() {
  mode = "auto";
  autoTheme = systemTheme();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore : le choix précédent restera simplement mémorisé */
  }
  syncAuto();
  publish();
}

export function useTheme() {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  return {
    theme: state.theme,
    auto: state.mode === "auto",
    autoSource: state.autoSource,
    setTheme,
    setAutoTheme,
  };
}
