import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Les réglages du guidage : le cadrage de la caméra, et la durée de
// conservation de l'historique. Tous deux vivent dans la section « Navigation »
// de la fenêtre des paramètres.
//
// Il suit le patron des autres réglages du projet — clé `osm-local:*`, lecture
// tolérante aux pannes (`try/catch`, mode privé), valeur inconnue écartée à la
// relecture — mais c'est un **magasin de module** et non un `useState` de hook,
// comme pour la langue. La raison est la même : la valeur est lue à deux
// endroits éloignés de l'arbre, la fenêtre des paramètres et la session de
// guidage, et `App` n'a pas de contexte, par choix d'architecture. Deux
// `useState` indépendants se désynchroniseraient — on changerait le réglage
// sans que le guidage l'apprenne.
// ---------------------------------------------------------------------------

/**
 * - `adaptive` : le zoom se déduit de la distance à la prochaine manœuvre —
 *   la carte s'écarte pour montrer d'un coup où l'on est et où l'on tourne,
 *   puis se resserre sur le carrefour à l'approche.
 * - `fixed` : une échelle constante, qui ne bouge jamais. Rien ne surprend,
 *   mais un virage lointain sort du cadre.
 */
export type NavCameraMode = "adaptive" | "fixed";

const STORAGE_KEY = "osm-local:nav-camera";

const DEFAULT_MODE: NavCameraMode = "adaptive";

function read(): NavCameraMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "adaptive" || stored === "fixed" ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE; // localStorage indisponible (mode privé, etc.)
  }
}

// Un seul jeu d'abonnés pour les deux réglages : ils sont lus par les mêmes
// écrans, et distinguer deux listes ferait deux fois le travail pour épargner
// un rendu de fenêtre de paramètres.
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

let mode: NavCameraMode = read();

/** Le réglage en vigueur, hors de tout composant. */
export function navCameraMode(): NavCameraMode {
  return mode;
}

export function setNavCameraMode(next: NavCameraMode) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore : le choix restera simplement non persisté */
  }
  mode = next;
  notify();
}

/**
 * Le réglage, **avec l'abonnement** qui redessine l'appelant quand il change :
 * c'est ce qui fait que basculer le choix dans les paramètres retouche le
 * cadrage d'un guidage en cours, sans attendre le relevé GPS suivant.
 */
export function useNavCameraMode(): NavCameraMode {
  return useSyncExternalStore(subscribe, navCameraMode, navCameraMode);
}

// ---------------------------------------------------------------------------
// Conservation de l'historique des trajets.
// ---------------------------------------------------------------------------

/**
 * Depuis combien de temps un trajet peut rester dans l'historique.
 *
 * `never` ne supprime jamais — c'est le défaut, parce qu'un historique qu'on
 * découvre amputé sans l'avoir demandé est pire qu'un historique qui grossit :
 * un trajet pèse quelques kilo-octets, il en faudrait des milliers pour peser.
 * `off` est l'autre bout : on n'enregistre plus rien du tout, et ce qui existe
 * déjà est effacé — choisir de ne pas garder de traces ne se satisfait pas
 * d'une promesse pour l'avenir seulement.
 */
export type HistoryRetention =
  | "never"
  | "year"
  | "6months"
  | "3months"
  | "month"
  | "week"
  | "day"
  | "off";

/** Combien de temps chaque choix laisse vivre un trajet, en millisecondes. */
const DAY = 24 * 60 * 60 * 1000;
export const RETENTION_MS: Record<HistoryRetention, number | null> = {
  never: null,
  year: 365 * DAY,
  "6months": 182 * DAY,
  "3months": 91 * DAY,
  month: 30 * DAY,
  week: 7 * DAY,
  day: DAY,
  off: 0,
};

const RETENTION_KEY = "osm-local:nav-history-retention";

const DEFAULT_RETENTION: HistoryRetention = "never";

function readRetention(): HistoryRetention {
  try {
    const stored = localStorage.getItem(RETENTION_KEY);
    return stored && stored in RETENTION_MS ? (stored as HistoryRetention) : DEFAULT_RETENTION;
  } catch {
    return DEFAULT_RETENTION; // localStorage indisponible (mode privé, etc.)
  }
}

let retention: HistoryRetention = readRetention();

/** Le réglage en vigueur, hors de tout composant. */
export function historyRetention(): HistoryRetention {
  return retention;
}

export function setHistoryRetention(next: HistoryRetention) {
  try {
    localStorage.setItem(RETENTION_KEY, next);
  } catch {
    /* ignore : le choix restera simplement non persisté */
  }
  retention = next;
  notify();
}

export function useHistoryRetention(): HistoryRetention {
  return useSyncExternalStore(subscribe, historyRetention, historyRetention);
}

/** La date avant laquelle un trajet doit être effacé, ou `null` si jamais. */
export function retentionCutoff(): number | null {
  const span = RETENTION_MS[retention];
  return span === null ? null : Date.now() - span;
}

// ---------------------------------------------------------------------------
// Les interrupteurs de la fenêtre « Modes » : le bouton de course, et la fiche
// de fin de chaque type de trajet. Tous activés par défaut — c'est ce que
// l'application faisait avant qu'on puisse les couper.
// ---------------------------------------------------------------------------

/** Un réglage oui/non, sur le même patron que les deux précédents. */
function booleanSetting(key: string, fallback: boolean) {
  function readValue(): boolean {
    try {
      const stored = localStorage.getItem(key);
      return stored === "on" ? true : stored === "off" ? false : fallback;
    } catch {
      return fallback; // localStorage indisponible (mode privé, etc.)
    }
  }

  let value = readValue();

  const get = () => value;

  function set(next: boolean) {
    try {
      localStorage.setItem(key, next ? "on" : "off");
    } catch {
      /* ignore : le choix restera simplement non persisté */
    }
    value = next;
    notify();
  }

  function useValue(): boolean {
    return useSyncExternalStore(subscribe, get, get);
  }

  return { get, set, useValue };
}

const runMode = booleanSetting("osm-local:run-mode", true);
const walkSummary = booleanSetting("osm-local:walk-summary", true);
const runSummary = booleanSetting("osm-local:run-summary", true);

/** Le bouton de course apparaît-il sous le burger ? */
export const runModeEnabled = runMode.get;
export const setRunModeEnabled = runMode.set;
export const useRunModeEnabled = runMode.useValue;

/** La fiche de fin s'ouvre-t-elle après une marche guidée ? */
export const walkSummaryEnabled = walkSummary.get;
export const setWalkSummaryEnabled = walkSummary.set;
export const useWalkSummaryEnabled = walkSummary.useValue;

/** La fiche de fin s'ouvre-t-elle après une course ? */
export const runSummaryEnabled = runSummary.get;
export const setRunSummaryEnabled = runSummary.set;
export const useRunSummaryEnabled = runSummary.useValue;
