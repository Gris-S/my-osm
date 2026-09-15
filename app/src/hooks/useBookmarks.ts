import { useCallback, useEffect, useState, useMemo } from "react";
import { safeColor } from "../utils/safe";
import type { FilterGroupId } from "../filters";
import type { Place } from "../types";
import { t } from "../i18n";

// ---------------------------------------------------------------------------
// Lieux enregistrés, rangés par dossiers.
//
// Même patron que les autres réglages persistés (`useTheme`, `useBasemap`,
// `usePlaceFilters`) : une clé `osm-local:*` dans `localStorage`, une lecture
// tolérante aux pannes (mode privé) et un filtrage de ce qui a été relu — un
// dossier mal formé est écarté plutôt que de faire échouer l'ensemble.
//
// Deux états y vivent : les dossiers eux-mêmes, et **ceux qui sont montrés sur
// la carte**. Le second est persisté aussi : retrouver ses points affichés d'une
// session à l'autre fait partie de ce qu'on attend d'un signet.
// ---------------------------------------------------------------------------

/** Un lieu enregistré. Le nom peut avoir été choisi par l'utilisateur. */
export interface SavedPlace {
  id: string;
  name: string;
  lon: number;
  lat: number;
  group: FilterGroupId | null;
  address?: string;
  savedAt: number;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  /** Couleur des pastilles de ce dossier sur la carte. */
  color: string;
  places: SavedPlace[];
}

/** Couleurs proposées pour un dossier — la palette iOS de l'application. */
export const FOLDER_COLORS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#af52de",
  "#ff2d55",
  "#8e8e93",
];

/**
 * Dossier créé d'office, et qu'on ne supprime pas : la fenêtre
 * d'enregistrement suppose au moins un dossier, et il vaut mieux un dossier
 * qu'on peut renommer et vider qu'un état où enregistrer devient impossible.
 */
export const DEFAULT_FOLDER_ID = "favoris";

const STORAGE_KEY = "osm-local:bookmarks";
const VISIBLE_KEY = "osm-local:bookmarks-visible";

/** Premier dossier, créé d'office : enregistrer ne doit pas commencer par une corvée. */
function defaultFolders(): BookmarkFolder[] {
  return [{ id: DEFAULT_FOLDER_ID, name: t("bookmarks.defaultFolder"), color: FOLDER_COLORS[0], places: [] }];
}

function newId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function readFolders(): BookmarkFolder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultFolders();
    const parsed = JSON.parse(raw) as BookmarkFolder[];
    if (!Array.isArray(parsed)) return defaultFolders();
    // Relecture prudente : un dossier sans identifiant ni nom n'est pas
    // récupérable, et un lieu sans coordonnées ne se placerait nulle part.
    const folders = parsed
      .filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        color: safeColor(folder.color, FOLDER_COLORS[0]),
        places: Array.isArray(folder.places)
          ? folder.places.filter(
              (place) => place && typeof place.id === "string" && Number.isFinite(place.lon) && Number.isFinite(place.lat)
            )
          : [],
      }));
    return folders.length ? folders : defaultFolders();
  } catch {
    return defaultFolders();
  }
}

function readVisible(): string[] {
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore : les signets resteront simplement le temps de la session */
  }
}

export function useBookmarks() {
  const [folders, setFolders] = useState<BookmarkFolder[]>(readFolders);
  const [visibleIds, setVisibleIds] = useState<string[]>(readVisible);

  useEffect(() => persist(STORAGE_KEY, folders), [folders]);
  useEffect(() => persist(VISIBLE_KEY, visibleIds), [visibleIds]);

  const createFolder = useCallback((name: string): string => {
    const id = newId();
    setFolders((current) => [
      ...current,
      {
        id,
        name: name.trim() || t("folder.fallbackName"),
        // La couleur suit l'ordre de la palette : deux dossiers créés à la
        // suite ne se ressemblent pas sur la carte.
        color: FOLDER_COLORS[current.length % FOLDER_COLORS.length],
        places: [],
      },
    ]);
    return id;
  }, []);

  const renameFolder = useCallback((id: string, name: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
    setFolders((current) => current.map((folder) => (folder.id === id ? { ...folder, name: cleaned } : folder)));
  }, []);

  const recolorFolder = useCallback((id: string, color: string) => {
    setFolders((current) => current.map((folder) => (folder.id === id ? { ...folder, color: safeColor(color, folder.color) } : folder)));
  }, []);

  /** Supprime un dossier et ce qu'il contient. Le dossier par défaut résiste. */
  const deleteFolder = useCallback((id: string) => {
    if (id === DEFAULT_FOLDER_ID) return;
    setFolders((current) => {
      const rest = current.filter((folder) => folder.id !== id);
      return rest.length ? rest : defaultFolders();
    });
    setVisibleIds((current) => current.filter((visible) => visible !== id));
  }, []);

  /** Enregistre un lieu dans un dossier, sous le nom donné. */
  const savePlace = useCallback((folderId: string, place: Place, name: string) => {
    const saved: SavedPlace = {
      id: place.id,
      name: name.trim() || place.name,
      lon: place.lon,
      lat: place.lat,
      group: place.group,
      address: place.address,
      savedAt: Date.now(),
    };
    setFolders((current) =>
      current.map((folder) => {
        // Un même lieu ne se range que dans un dossier : on l'enlève des
        // autres plutôt que de le laisser en double sur la carte.
        const without = folder.places.filter((existing) => existing.id !== saved.id);
        return folder.id === folderId ? { ...folder, places: [saved, ...without] } : { ...folder, places: without };
      })
    );
    // Un lieu qu'on vient d'enregistrer doit se voir : son dossier s'allume.
    setVisibleIds((current) => (current.includes(folderId) ? current : [...current, folderId]));
  }, []);

  const removePlace = useCallback((placeId: string) => {
    setFolders((current) =>
      current.map((folder) => ({ ...folder, places: folder.places.filter((place) => place.id !== placeId) }))
    );
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setVisibleIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }, []);

  /** Le dossier et l'enregistrement d'un lieu, s'il est enregistré. */
  const findSaved = useCallback(
    (placeId: string | undefined) => {
      if (!placeId) return undefined;
      for (const folder of folders) {
        const place = folder.places.find((saved) => saved.id === placeId);
        if (place) return { folder, place };
      }
      return undefined;
    },
    [folders]
  );

  /**
   * Les points à dessiner : ceux des dossiers allumés, à leur couleur.
   * **Mémorisés** : la carte retire et repose tous les repères quand la liste
   * change d'identité, et un nouveau tableau à chaque rendu les refaisait à
   * chaque relevé GPS d'une navigation.
   */
  const visiblePlaces = useMemo(
    () =>
      folders
        .filter((folder) => visibleIds.includes(folder.id))
        .flatMap((folder) => folder.places.map((place) => ({ ...place, color: folder.color }))),
    [folders, visibleIds]
  );

  // Un seul objet tant que rien ne change : le menu des signets est protégé
  // contre les rendus inutiles (`memo`).
  return useMemo(
    () => ({
      folders,
      visibleIds,
      visiblePlaces,
      createFolder,
      renameFolder,
      recolorFolder,
      deleteFolder,
      savePlace,
      removePlace,
      toggleVisible,
      findSaved,
    }),
    [folders, visibleIds, visiblePlaces, createFolder, renameFolder, recolorFolder, deleteFolder, savePlace, removePlace, toggleVisible, findSaved]
  );
}

export type Bookmarks = ReturnType<typeof useBookmarks>;
