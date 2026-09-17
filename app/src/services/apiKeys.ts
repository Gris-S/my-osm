import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Les clés d'API, saisissables depuis les paramètres.
//
// Elles venaient uniquement de `.env.local`, c'est-à-dire d'un fichier qu'il
// faut éditer puis recompiler. Elles peuvent désormais être saisies dans
// l'application, ce qui est la seule façon d'en changer une fois l'application
// empaquetée en APK — un fichier `.env` n'existe plus à ce moment-là.
//
// **Trois états par emplacement**, et la nuance compte :
//
//   rien de stocké   la valeur compilée depuis `.env.local` est employée
//   valeur stockée   elle l'emporte sur la valeur compilée
//   vide stocké      aucune clé, et la valeur compilée est **ignorée**
//
// Le troisième état est ce qui donne un vrai « supprimer ». Sans lui, effacer
// une clé saisie ferait simplement réapparaître celle du fichier, et il serait
// impossible de faire taire une clé compilée dans le programme. La valeur
// compilée, elle, ne peut pas être retirée du fichier depuis l'application :
// elle est dans le code envoyé au navigateur. L'interface le dit.
//
// C'est un **magasin de module** et non un hook d'état, pour la même raison que
// la langue et les réglages de guidage : la valeur est lue par des services qui
// ne sont pas des composants (`services/idfm.ts`, `services/weather.ts`,
// `navigation/car/carRoute.ts`), et `App` n'a pas de contexte.
// ---------------------------------------------------------------------------

/** Les emplacements de clé, dans l'ordre où les paramètres les présentent. */
export type ApiKeyId =
  | "tomtom"
  | "idfm"
  | "mapillary"
  | "meteofranceApiKey";

export interface ApiKeySlot {
  id: ApiKeyId;
  /** Clé de traduction du libellé de l'emplacement. */
  label: string;
  /** La valeur compilée depuis `.env.local`, vide s'il n'y en avait pas. */
  builtIn: string;
}

/**
 * Les emplacements et leur valeur compilée.
 *
 * `import.meta.env` est lu **ici et nulle part ailleurs** pour les clés : c'est
 * ce qui permet à `config.ts` de n'exposer que la valeur effective, sans que le
 * reste de l'application ait à savoir d'où elle vient.
 */
export const API_KEY_SLOTS: ApiKeySlot[] = [
  { id: "tomtom", label: "apikeys.tomtom", builtIn: import.meta.env.VITE_TOMTOM_KEY ?? "" },
  { id: "idfm", label: "apikeys.idfm", builtIn: import.meta.env.VITE_IDFM_API_KEY ?? "" },
  { id: "mapillary", label: "apikeys.mapillary", builtIn: import.meta.env.VITE_MAPILLARY_TOKEN ?? "" },
  {
    id: "meteofranceApiKey",
    label: "apikeys.meteofranceApiKey",
    builtIn: import.meta.env.VITE_METEOFRANCE_API_KEY ?? "",
  },
];

const STORAGE_KEY = "osm-local:api-keys";

/** D'où vient la valeur employée pour un emplacement. */
export type KeyOrigin = "stored" | "builtIn" | "none";

/** Ce que l'application a retenu : une valeur par emplacement touché. */
type Stored = Partial<Record<ApiKeyId, string>>;

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Relecture tolérante, comme les autres réglages persistés : un
    // emplacement inconnu — renommé depuis, ou écrit par une version
    // antérieure — est écarté plutôt que de faire échouer toute la lecture.
    const known = new Set<string>(API_KEY_SLOTS.map((slot) => slot.id));
    const out: Stored = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (known.has(id) && typeof value === "string") out[id as ApiKeyId] = value;
    }
    return out;
  } catch {
    return {}; // localStorage indisponible (mode privé), ou JSON abîmé
  }
}

let stored: Stored = read();

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: Stored) {
  stored = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Écriture impossible : le réglage vaut pour la session, ce qui est mieux
    // que de refuser la saisie.
  }
  for (const listener of listeners) listener();
}

function slotOf(id: ApiKeyId): ApiKeySlot {
  return API_KEY_SLOTS.find((slot) => slot.id === id) ?? { id, label: id, builtIn: "" };
}

/**
 * La valeur employée pour cet emplacement. C'est ce que lisent `config.ts` et,
 * à travers lui, tous les services.
 */
export function apiKey(id: ApiKeyId): string {
  const own = stored[id];
  if (own !== undefined) return own; // y compris la chaîne vide : c'est un refus explicite
  return slotOf(id).builtIn;
}

/** D'où vient cette valeur, pour que l'interface puisse le dire. */
export function keyOrigin(id: ApiKeyId): KeyOrigin {
  const own = stored[id];
  if (own !== undefined) return own.length > 0 ? "stored" : "none";
  return slotOf(id).builtIn.length > 0 ? "builtIn" : "none";
}

/** Retient une clé saisie. Une chaîne vide vaut suppression (voir `clearApiKey`). */
export function setApiKey(id: ApiKeyId, value: string): void {
  commit({ ...stored, [id]: value.trim() });
}

/**
 * Supprime la clé de cet emplacement.
 *
 * On **écrit une chaîne vide** plutôt que d'oublier l'entrée : c'est ce qui
 * distingue « je ne veux pas de clé ici » de « je n'y ai jamais touché », et
 * donc ce qui permet de faire taire une clé compilée dans le programme.
 */
export function clearApiKey(id: ApiKeyId): void {
  commit({ ...stored, [id]: "" });
}

/**
 * Oublie ce que l'application avait retenu, et revient à la valeur compilée
 * s'il y en a une. C'est l'inverse exact de `clearApiKey`.
 */
export function restoreBuiltIn(id: ApiKeyId): void {
  const next = { ...stored };
  delete next[id];
  commit(next);
}

/** Vrai si un emplacement peut revenir à une valeur compilée. */
export function hasBuiltIn(id: ApiKeyId): boolean {
  return slotOf(id).builtIn.length > 0;
}

function snapshot(): Stored {
  return stored;
}

/**
 * S'abonne au magasin. Les composants des paramètres l'appellent pour se
 * redessiner quand une clé change — y compris quand elle change depuis un autre
 * emplacement du même écran.
 */
export function useApiKeys(): { keys: Stored } {
  return { keys: useSyncExternalStore(subscribe, snapshot, snapshot) };
}
