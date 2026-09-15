import { useSyncExternalStore } from "react";
import type { Place } from "../types";

// ---------------------------------------------------------------------------
// Le domicile et le lieu de travail.
//
// Deux adresses qu'on saisit une fois et qu'on emploie tous les jours : ce sont
// de loin les deux destinations les plus fréquentes d'un itinéraire, et les
// retaper chaque matin n'a pas de sens.
//
// **Ce ne sont pas des signets**, et ils ne passent donc pas par
// `useBookmarks`. Un signet est un lieu qu'on a rangé parmi d'autres, dans un
// dossier, et qu'on retrouve en ouvrant une liste ; ceux-ci sont deux **rôles**
// uniques, offerts d'un geste dès qu'un champ d'itinéraire s'ouvre. Les mêler
// aurait obligé à traiter deux dossiers comme des cas particuliers partout.
//
// Même patron que les autres réglages persistés du projet : clé `osm-local:*`,
// lecture tolérante aux pannes (`try/catch`, mode privé), et **filtrage de ce
// qui est relu** — une adresse sans coordonnées ne mènerait nulle part, elle
// est écartée plutôt que de faire échouer toute la relecture.
// ---------------------------------------------------------------------------

/** Les deux rôles. Le type est exporté : l'interface les parcourt. */
export type HomeWorkRole = "home" | "work";

export const HOME_WORK_ROLES: HomeWorkRole[] = ["home", "work"];

const STORAGE_KEY = "osm-local:home-work";

type Saved = Partial<Record<HomeWorkRole, Place>>;

function valid(value: unknown): value is Place {
  if (!value || typeof value !== "object") return false;
  const place = value as Place;
  return (
    typeof place.id === "string" &&
    typeof place.name === "string" &&
    Number.isFinite(place.lon) &&
    Number.isFinite(place.lat)
  );
}

function read(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Saved = {};
    for (const role of HOME_WORK_ROLES) {
      const value = (parsed as Record<string, unknown>)[role];
      if (valid(value)) out[role] = value;
    }
    return out;
  } catch {
    return {}; // localStorage indisponible, ou JSON abîmé
  }
}

export interface HomeWork {
  home: Place | null;
  work: Place | null;
  /** Retient un lieu dans ce rôle — il n'y en a qu'un par rôle. */
  set: (role: HomeWorkRole, place: Place) => void;
  /** Oublie l'adresse de ce rôle. */
  clear: (role: HomeWorkRole) => void;
}

// **Un magasin de module**, et non un `useState` par composant : les adresses
// sont lues par la barre de recherche et le panneau d'itinéraire (via `App`) et
// modifiées dans la fenêtre des paramètres (`AppMenu`). Deux états séparés se
// désynchroniseraient — on changerait la maison dans les paramètres sans que la
// recherche l'apprenne. Même patron que les réglages de navigation.
let saved: Saved = read();
const listeners = new Set<() => void>();

function write(next: Saved) {
  saved = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Écriture impossible : le réglage vaut pour la session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => saved;

function setRole(role: HomeWorkRole, place: Place) {
  write({ ...saved, [role]: place });
}

function clearRole(role: HomeWorkRole) {
  const next = { ...saved };
  delete next[role];
  write(next);
}

export function useHomeWork(): HomeWork {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { home: current.home ?? null, work: current.work ?? null, set: setRole, clear: clearRole };
}
