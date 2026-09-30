import { useSyncExternalStore } from "react";
import { CONFIG } from "../config";
import type { TranslationKey } from "../i18n";
import { OsmError, whoAmI } from "./osmEdit";

// ---------------------------------------------------------------------------
// « Contribuer à OpenStreetMap » : le réglage, le compte, et les lieux déjà
// ajoutés pendant la session.
//
// **Un magasin de module**, comme les clés d'API : la valeur est lue par la
// fiche d'un lieu (le bouton « + OSM »), la fenêtre des paramètres (l'option),
// la fenêtre « API » (le compte) et la fenêtre d'ajout — quatre endroits
// éloignés de l'arbre, et `App` n'a pas de contexte.
//
// **L'option est éteinte par défaut** (demande explicite : ne rien ralentir
// pour qui ne veut pas contribuer). Éteinte, rien n'est chargé ni vérifié —
// pas même le jeton —, et le bouton n'existe pas.
//
// **Le jeton est gardé, jamais un mot de passe** : OSM n'accepte plus
// identifiant et mot de passe depuis juin 2024, et ses jetons n'expirent pas.
// ---------------------------------------------------------------------------

interface Stored {
  enabled: boolean;
  /** Client ID saisi ; absent, celui de `CONFIG.OSM_EDIT` sert. */
  clientId?: string;
  token?: string;
}

/** L'état du compte, établi par un appel réel (`whoAmI`), jamais supposé. */
export type AccountState =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "ok"; name: string }
  | { kind: "revoked" }
  | { kind: "unreachable" };

export interface OsmContribState extends Stored {
  account: AccountState;
  /** Lieux du web ajoutés à OSM depuis le lancement : identifiant `web/…` → lien du point. */
  published: ReadonlyMap<string, string>;
}

const STORAGE_KEY = "osm-local:osm-contrib";

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Relecture tolérante. Les versions de mise au point rangeaient Client ID
    // et jeton par serveur (`{ live, dev }`) : seul celui de l'OSM réel est
    // repris, le serveur de test ayant été retiré.
    const pick = (value: unknown): string | undefined => {
      if (typeof value === "string") return value || undefined;
      const live = value && typeof value === "object" ? (value as Record<string, unknown>).live : undefined;
      return typeof live === "string" && live ? live : undefined;
    };
    return { enabled: parsed.enabled === true, clientId: pick(parsed.clientId), token: pick(parsed.token) };
  } catch {
    return { enabled: false };
  }
}

let state: OsmContribState = { ...read(), account: { kind: "none" }, published: new Map() };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(patch: Partial<OsmContribState>) {
  state = { ...state, ...patch };
  const { enabled, clientId, token } = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, clientId, token }));
  } catch {
    /* le réglage vaut pour la session */
  }
  for (const listener of listeners) listener();
}

function snapshot(): OsmContribState {
  return state;
}

export function useOsmContrib(): OsmContribState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function osmContrib(): OsmContribState {
  return state;
}

export function setContribEnabled(enabled: boolean): void {
  update({ enabled });
}

/** Le Client ID employé : saisi, sinon celui de la configuration. */
export function osmClientId(): string {
  return (state.clientId ?? CONFIG.OSM_EDIT.CLIENT_ID).trim();
}

export function builtInClientId(): string {
  return CONFIG.OSM_EDIT.CLIENT_ID;
}

export function setOsmClientId(value: string): void {
  const v = value.trim();
  // Revenir à la valeur de la configuration, c'est oublier la saisie.
  update({ clientId: !v || v === CONFIG.OSM_EDIT.CLIENT_ID ? undefined : v });
}

export function osmToken(): string | undefined {
  return state.token;
}

export function setOsmToken(token: string): void {
  // Se connecter, c'est vouloir contribuer : l'option s'allume avec. Connecté
  // mais option éteinte, le bouton n'apparaissait pas et rien ne disait
  // pourquoi (constaté).
  update({ token, enabled: true });
  void verifyAccount();
}

export function logoutOsm(): void {
  update({ token: undefined, account: { kind: "none" } });
}

export function markPublished(placeId: string, link: string): void {
  const published = new Map(state.published);
  published.set(placeId, link);
  update({ published });
}

let checkTurn = 0;

/**
 * Établit l'état du compte par un appel réel. Appelé à
 * l'ouverture des fenêtres qui en ont besoin, jamais au démarrage : l'option
 * éteinte ne doit rien coûter.
 */
export async function verifyAccount(): Promise<void> {
  const token = state.token;
  const mine = ++checkTurn;
  if (!token) {
    update({ account: { kind: "none" } });
    return;
  }
  update({ account: { kind: "checking" } });
  let account: AccountState;
  try {
    account = { kind: "ok", name: await whoAmI(token) };
  } catch (error) {
    account = error instanceof OsmError && error.key === "osm.error.revoked" ? { kind: "revoked" } : { kind: "unreachable" };
  }
  if (mine === checkTurn && token === state.token) update({ account });
}

/** Le message d'une erreur venue d'`osmEdit`, pour l'interface. */
export function errorKey(error: unknown): TranslationKey {
  return error instanceof OsmError ? error.key : "osm.error.unreachable";
}
