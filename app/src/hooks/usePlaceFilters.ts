import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_GROUP_IDS, type FilterGroupId } from "../filters";

// ---------------------------------------------------------------------------
// Catégories de POI affichées sur la carte (menu des catégories).
//
// La sélection est mémorisée dans `localStorage`, comme le thème et le fond de
// carte. Par défaut, tout est affiché.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:filters";

function readStored(): FilterGroupId[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // On ne garde que les identifiants encore connus : une catégorie retirée du
    // code ne doit pas ressusciter depuis un stockage ancien.
    return ALL_GROUP_IDS.filter((id) => parsed.includes(id));
  } catch {
    return null;
  }
}

/** État « tout coché » / « rien coché » / « sélection partielle ». */
export type SelectionState = "all" | "none" | "some";

export function usePlaceFilters() {
  const [selected, setSelected] = useState<FilterGroupId[]>(() => readStored() ?? ALL_GROUP_IDS);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      /* ignore : la sélection restera simplement non persistée */
    }
  }, [selected]);

  const isSelected = useCallback((id: FilterGroupId) => selected.includes(id), [selected]);

  const toggle = useCallback((id: FilterGroupId) => {
    // On reconstruit la liste depuis `ALL_GROUP_IDS` pour conserver un ordre
    // stable (utile pour la clé de dépendance qui déclenche le rechargement).
    setSelected((prev) =>
      ALL_GROUP_IDS.filter((candidate) =>
        candidate === id ? !prev.includes(candidate) : prev.includes(candidate)
      )
    );
  }, []);

  const selectAll = useCallback(() => setSelected(ALL_GROUP_IDS), []);
  const selectNone = useCallback(() => setSelected([]), []);

  const state: SelectionState =
    selected.length === 0 ? "none" : selected.length === ALL_GROUP_IDS.length ? "all" : "some";

  /** Bascule « Tout / Aucun » : depuis n'importe quel état partiel, on coche tout. */
  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.length === ALL_GROUP_IDS.length ? [] : ALL_GROUP_IDS));
  }, []);

  // Clé stable pour les effets qui doivent relancer une requête réseau.
  const key = useMemo(() => selected.join(","), [selected]);

  return { selected, key, state, isSelected, toggle, toggleAll, selectAll, selectNone };
}
