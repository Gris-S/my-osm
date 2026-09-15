import { useCallback, useEffect, useState } from "react";
import { normalizeBrand } from "../services/geocode";
import type { Place } from "../types";

// ---------------------------------------------------------------------------
// Historique des recherches (barre de recherche principale).
//
// Même patron que les autres réglages persistés (`osm-local:*` dans
// `localStorage`, lecture tolérante aux pannes, entrées invalides écartées à la
// relecture) — voir `usePlaceFilters` et `useBookmarks`.
//
// Une entrée de lieu **garde le lieu retenu**, coordonnées comprises : la
// rejouer rouvre sa fiche et recentre la carte, sans repasser par le géocodage.
// Retrouver un endroit où l'on est déjà allé ne doit rien coûter ni rien faire
// attendre. Une entrée d'enseigne n'a, elle, rien à garder : c'est un nom qu'on
// repose sur la carte visible, et l'endroit d'où on le demande a changé.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:search-history";

/** Entrées gardées. Deux sont montrées, les autres servent à la saisie. */
const MAX_ENTRIES = 20;

/**
 * Une recherche passée.
 *
 * Le genre dit ce qu'on rejoue : un lieu se rouvre tel quel, une enseigne
 * redemande ses pastilles à la zone visible.
 */
export type SearchHistoryEntry =
  | { kind: "place"; label: string; place: Place }
  | { kind: "brand"; label: string };

function isValidEntry(value: unknown): value is SearchHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const { kind, label, place } = value as { kind?: unknown; label?: unknown; place?: unknown };
  if (typeof label !== "string" || label.trim() === "") return false;
  if (kind === "brand") return true;
  if (kind !== "place") return false;
  // Un lieu sans coordonnées ne se rouvrirait nulle part : on l'écarte plutôt
  // que de faire échouer toute la relecture.
  if (typeof place !== "object" || place === null) return false;
  const { id, name, lon, lat } = place as Partial<Place>;
  return (
    typeof id === "string" &&
    typeof name === "string" &&
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    typeof lat === "number" &&
    Number.isFinite(lat)
  );
}

function readStored(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).slice(0, MAX_ENTRIES);
  } catch {
    return []; // localStorage indisponible (mode privé, etc.)
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryEntry[]>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* ignore : l'historique restera simplement non persisté */
    }
  }, [history]);

  /** Ajoute une recherche en tête, sans doublon (la plus récente l'emporte). */
  const remember = useCallback((entry: SearchHistoryEntry) => {
    const label = entry.label.trim();
    if (!label) return;
    const key = normalizeBrand(label);
    setHistory((prev) =>
      [
        { ...entry, label },
        // Le genre fait partie de l'identité : chercher « Fnac » et afficher
        // toutes les Fnac ne sont pas la même recherche.
        ...prev.filter((old) => !(old.kind === entry.kind && normalizeBrand(old.label) === key)),
      ].slice(0, MAX_ENTRIES)
    );
  }, []);

  return { history, remember };
}

/**
 * Les entrées à proposer pour la saisie en cours.
 *
 * Champ vide (au premier clic) : les **deux** dernières recherches. Dès qu'on
 * tape : **une seule**, la plus récente qui commence par ce qui est tapé — le
 * champ propose alors une suite, il n'ouvre plus une liste. Taper « f » rappelle
 * ainsi « Fnac ».
 *
 * Un mot intérieur compte aussi (« bac » retrouve « rue du Bac »), mais après
 * les libellés qui commencent par la saisie : c'est le début du nom qu'on tape
 * le plus souvent. Une entrée identique à la saisie est tue — elle ne
 * proposerait rien de plus que ce qui est déjà écrit.
 */
export function matchHistory(history: SearchHistoryEntry[], query: string): SearchHistoryEntry[] {
  const wanted = normalizeBrand(query);
  if (!wanted) return history.slice(0, 2);

  let byWord: SearchHistoryEntry | null = null;
  for (const entry of history) {
    const label = normalizeBrand(entry.label);
    if (label === wanted) continue;
    if (label.startsWith(wanted)) return [entry];
    if (!byWord && label.split(" ").some((word) => word.startsWith(wanted))) byWord = entry;
  }
  return byWord ? [byWord] : [];
}
