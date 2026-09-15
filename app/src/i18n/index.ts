import { useSyncExternalStore } from "react";
import { fr, type Dict, type PluralKey, type TranslationKey } from "./fr";
import { en } from "./en";

// ---------------------------------------------------------------------------
// Langue de l'interface (français par défaut, anglais au choix).
//
// Ce n'est **pas** un hook comme les autres réglages persistés, et c'est
// délibéré : la langue est lue par une quarantaine de composants, dont
// certains très loin d'`App`. La faire descendre en prop traverserait toute
// l'application pour une valeur qui change une fois par an ; un contexte
// remonterait le même mur (`App` n'en a aucun, par choix d'architecture).
//
// D'où un magasin minuscule au niveau du module, lu par `useSyncExternalStore` :
// chaque composant qui affiche du texte appelle `useI18n()`, s'abonne, et se
// redessine quand la langue change. Les services et utilitaires, eux, appellent
// `t()` directement — la fonction lit la langue en vigueur au moment de
// l'appel.
//
// Deux règles à respecter en y touchant :
//
// - **`fr` est la référence.** Ses clés définissent le type `Dict` ; `en` est
//   typé dessus, si bien qu'une traduction manquante ou en trop casse le build
//   au lieu d'afficher une clé nue à l'utilisateur.
// - **Un composant qui affiche du texte appelle `useI18n()`**, même s'il ne se
//   sert que de `t` : sans l'abonnement, il garderait l'ancienne langue jusqu'à
//   son prochain rendu pour une autre raison. Et une valeur textuelle calculée
//   par `useMemo` doit prendre `lang` dans ses dépendances.
// ---------------------------------------------------------------------------

export type Lang = "fr" | "en";
export type { PluralKey, TranslationKey };

const STORAGE_KEY = "osm-local:lang";

const DICTS: Record<Lang, Dict> = { fr, en };

/**
 * Locale de formatage des dates, heures et nombres.
 *
 * `en-GB` plutôt qu'`en-US` : l'application décrit un territoire où l'on
 * compte les heures de 0 à 24 et où le 9 août ne s'écrit pas 8/9.
 */
const LOCALES: Record<Lang, string> = { fr: "fr-FR", en: "en-GB" };

function systemLang(): Lang {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "fr" || base === "en") return base;
  }
  // Ni français ni anglais : le français reste la langue de référence de
  // l'application, c'est elle qu'on sert plutôt qu'une traduction de secours.
  return "fr";
}

function readStored(): Lang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "fr" || stored === "en" ? stored : null;
  } catch {
    return null; // localStorage indisponible (mode privé, etc.)
  }
}

interface LangState {
  lang: Lang;
  /** Vrai tant que l'utilisateur n'a pas choisi de langue lui-même. */
  followSystem: boolean;
}

let state: LangState = { lang: readStored() ?? systemLang(), followSystem: readStored() === null };

const listeners = new Set<() => void>();

function setState(next: LangState) {
  state = next;
  document.documentElement.lang = next.lang;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Le navigateur peut changer de langue en cours de route ; tant que
// l'utilisateur n'a rien choisi, on le suit, comme `useTheme` suit
// `prefers-color-scheme`.
if (typeof window !== "undefined") {
  document.documentElement.lang = state.lang;
  window.addEventListener("languagechange", () => {
    if (state.followSystem) setState({ lang: systemLang(), followSystem: true });
  });
}

/** Choisit une langue et la mémorise. */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore : le choix restera simplement non persisté */
  }
  setState({ lang, followSystem: false });
}

/**
 * Revient à la langue de l'appareil, et **efface** le choix mémorisé — comme
 * « Système » pour le thème : sans cet effacement, l'application cesserait de
 * suivre l'appareil.
 */
export function followSystemLang() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore : le choix précédent restera simplement mémorisé */
  }
  setState({ lang: systemLang(), followSystem: true });
}

/** La langue en vigueur, hors de tout composant. */
export function currentLang(): Lang {
  return state.lang;
}

/** La locale de formatage en vigueur (`fr-FR`, `en-GB`). */
export function currentLocale(): string {
  return LOCALES[state.lang];
}

export type Vars = Record<string, string | number>;

/**
 * Traduit une clé. Les variables se notent `{nom}` dans le dictionnaire.
 *
 * Utilisable partout, y compris hors de React : la langue est lue à l'appel.
 * Dans un composant, passer par `useI18n()` — sinon rien ne le redessinera au
 * changement de langue.
 */
export function t(key: TranslationKey, vars?: Vars): string {
  const template = DICTS[state.lang][key] ?? fr[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * Traduit une clé au pluriel, à partir des variantes `<clé>_one` et
 * `<clé>_other`. Le nombre est disponible dans le libellé sous `{count}`.
 *
 * Les deux langues ne coupent pas au même endroit : le français dit « 0 lieu »
 * et l'anglais « 0 places ». C'est la seule différence de règle, d'où ce test
 * plutôt qu'une dépendance de plus.
 */
export function tp(key: PluralKey, count: number, vars?: Vars): string {
  const one = state.lang === "fr" ? Math.abs(count) < 2 : Math.abs(count) === 1;
  return t(`${key}_${one ? "one" : "other"}` as TranslationKey, { count, ...vars });
}

/**
 * Le modèle coupé autour d'une variable, pour l'entourer d'un élément JSX
 * (`<code>`, `<strong>`) : la phrase reste **une seule clé**, et le traducteur
 * garde la liberté de placer la variable où sa langue l'exige — ce qu'une
 * phrase coupée en deux clés lui interdirait.
 */
export function tParts(key: TranslationKey, slot = "{name}", vars?: Vars): [string, string] {
  const [before, after] = t(key, vars).split(slot);
  return [before ?? "", after ?? ""];
}

export interface I18n {
  t: typeof t;
  tp: typeof tp;
  tParts: typeof tParts;
  lang: Lang;
  /** Locale de formatage (`fr-FR`, `en-GB`), pour `toLocaleDateString` & co. */
  locale: string;
}

/**
 * Ce dont un composant a besoin pour afficher du texte, et l'abonnement qui le
 * redessine au changement de langue.
 */
export function useI18n(): I18n {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return { t, tp, tParts, lang: snapshot.lang, locale: LOCALES[snapshot.lang] };
}

/** Le réglage lui-même, pour la fenêtre des paramètres. */
export function useLangSetting() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return { lang: snapshot.lang, followSystem: snapshot.followSystem, setLang, followSystemLang };
}
