import { useSyncExternalStore } from "react";
import { fr, type Dict, type PluralKey, type TranslationKey } from "./fr";
import { en } from "./en";

// ---------------------------------------------------------------------------
// Langue de l'interface (anglais par défaut, français au choix).
//
// **L'anglais est servi par défaut, y compris sur un téléphone en français.**
// L'application est publiée pour un public international — ses descriptions,
// ses captures et ses notes de version sont en anglais — et c'est dans cette
// langue qu'elle doit se présenter à qui l'installe sans rien savoir d'elle.
// Le francophone la repasse en français en deux touches, et « Système » reste
// offert pour suivre l'appareil.
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

/** Ce que l'application sert quand personne n'a rien choisi. */
const DEFAULT_LANG: Lang = "en";

function systemLang(): Lang {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "fr" || base === "en") return base;
  }
  // Ni français ni anglais : on sert la langue par défaut de l'application
  // plutôt qu'une traduction que l'appareil ne réclamait pas.
  return DEFAULT_LANG;
}

/**
 * Le choix enregistré, `"system"` compris.
 *
 * **« Système » s'écrit, il ne se déduit plus d'une absence.** Tant que
 * l'absence de valeur signifiait « suivre l'appareil », les deux se
 * confondaient sans dommage. Depuis que l'absence signifie « anglais », les
 * distinguer est indispensable : sans cela, choisir « Système » puis rouvrir
 * l'application rendrait l'anglais, et l'option ne marcherait tout simplement
 * pas.
 */
function readStored(): Lang | "system" | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "fr" || stored === "en" || stored === "system" ? stored : null;
  } catch {
    return null; // localStorage indisponible (mode privé, etc.)
  }
}

interface LangState {
  lang: Lang;
  /** Vrai quand l'utilisateur a demandé de suivre la langue de l'appareil. */
  followSystem: boolean;
}

function initialState(): LangState {
  const stored = readStored();
  if (stored === "system") return { lang: systemLang(), followSystem: true };
  return { lang: stored ?? DEFAULT_LANG, followSystem: false };
}

let state: LangState = initialState();

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
 * Suit la langue de l'appareil, et **l'enregistre comme tel**.
 *
 * Ce choix s'écrivait autrefois en effaçant la clé, l'absence valant « suivre
 * l'appareil ». Ce n'est plus possible : l'absence vaut désormais « anglais »,
 * et effacer reviendrait à annuler le choix qu'on vient de faire.
 */
export function followSystemLang() {
  try {
    localStorage.setItem(STORAGE_KEY, "system");
  } catch {
    /* ignore : le choix restera simplement non persisté */
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
