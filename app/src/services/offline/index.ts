// ---------------------------------------------------------------------------
// L'interface publique des cartes hors ligne.
//
// Tout ce que le reste de l'application connaît des zones téléchargées passe
// par ici : la liste, la création, la suppression, la vérification de
// fraîcheur, la recherche et les détails de lieux. `MapView` n'en sait rien —
// les tuiles lui arrivent par le Service Worker dans un navigateur, et par
// `nativeTiles.ts` dans l'APK.
// ---------------------------------------------------------------------------

import { CONFIG } from "../../config";
import type { Place } from "../../types";
import type { FilterGroupId } from "../../filters";
import type { PlaceDetails } from "../overpass";
import { cacheKeyFor, type TileRef } from "./keys";
import { assetPath, pathOf } from "./blobStore";
import { downloadRegion, resolveVectorTemplate, versionOf, type Progress } from "./download";
import {
  deleteRegion as deleteRegionRows,
  freeBytes,
  getStoredPlace,
  listRegions,
  putRegion,
  searchEntries,
  storageEstimate,
  storeName,
  type OfflineRegion,
} from "./store";
import { footprintTiles, type Bbox } from "./tiles";
import type { Area } from "./area";

export type { OfflineRegion, Progress };
export { formatBytes, estimateVectorBytes, estimateRasterBytes, countTiles } from "./tiles";
export { freeBytes, listRegions, storageEstimate, storeName };

/** Crée l'enregistrement d'une zone, avant tout téléchargement. */
export function newRegion(params: {
  name: string;
  bbox: Bbox;
  area?: Area;
  detail: OfflineRegion["detail"];
  vectorMaxZoom: number;
  countryCode?: string;
  satelliteMaxZoom: number | null;
  reliefMaxZoom: number | null;
  addresses: boolean;
  addressDepts: string[];
}): OfflineRegion {
  return {
    id: `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...params,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tileVersion: "",
    checkedAt: 0,
    bytes: 0,
    tilesDone: 0,
    tilesTotal: 0,
    placesCount: 0,
    addressCount: 0,
    status: "pending",
  };
}

export { downloadRegion };

/**
 * Met une zone à jour : le même téléchargement, mais en repassant par-dessus
 * les tuiles existantes. Le palier de détail et l'imagerie choisis sont
 * conservés — mettre à jour ne doit pas faire perdre ce qu'on avait demandé.
 */
export function refreshRegion(
  region: OfflineRegion,
  onProgress: (p: Progress) => void,
) {
  return downloadRegion(region, onProgress, true);
}

/**
 * Supprime une zone sans crever ses voisines.
 *
 * Deux zones qui se touchent partagent forcément leurs tuiles de zoom faible —
 * au zoom 0 il n'y en a qu'une pour la planète. On établit donc d'abord la
 * liste des clés que les **autres** zones réclament encore, et l'on ne retire
 * que le reste.
 */
export async function removeRegion(id: string): Promise<void> {
  const others = (await listRegions()).filter((r) => r.id !== id);
  const keep = new Set<string>();
  for (const region of others) {
    for (const t of footprintTiles(region, region.vectorMaxZoom)) {
      keep.add(pathOf(cacheKeyFor({ ...t, kind: "vector" })));
    }
    if (region.satelliteMaxZoom !== null) {
      for (const t of footprintTiles(region, region.satelliteMaxZoom)) {
        keep.add(pathOf(cacheKeyFor({ ...t, kind: "esri" } as TileRef)));
        keep.add(pathOf(cacheKeyFor({ ...t, kind: "ign" } as TileRef)));
      }
    }
    if (region.reliefMaxZoom !== null) {
      for (const t of footprintTiles(region, region.reliefMaxZoom)) {
        keep.add(pathOf(cacheKeyFor({ ...t, kind: "dem" } as TileRef)));
      }
      for (const t of footprintTiles(region, region.reliefMaxZoom, CONFIG.CONTOUR_MIN_ZOOM)) {
        keep.add(pathOf(cacheKeyFor({ ...t, kind: "contour" } as TileRef)));
      }
    }
  }
  // L'habillage du style est commun à toutes les zones et ne pèse qu'un
  // mégaoctet : on le garde tant qu'il reste une zone.
  if (others.length) {
    for (const url of [
      CONFIG.MAP_STYLE_URL,
      "https://tiles.openfreemap.org/planet",
    ]) {
      keep.add(assetPath(url));
    }
    // Les pictogrammes et les polices ne sont pas énumérables ici sans relire
    // le style : le magasin les conserve donc en les reconnaissant à leur
    // préfixe.
    keep.add("assets");
  }

  await deleteRegionRows(id, keep);
}

// --- Fraîcheur -------------------------------------------------------------

export interface Freshness {
  /** Version publiée en amont, ou `null` si l'on n'a pas pu la lire. */
  latest: string | null;
  stale: OfflineRegion[];
  checkedAt: number;
}

/**
 * Vérifie si les zones sont à jour, sans rien retélécharger.
 *
 * C'est possible parce que l'URL des tuiles d'OpenFreeMap porte un numéro de
 * version daté : une seule requête sur le TileJSON, quelques kilo-octets, et
 * l'on sait si les données ont changé. Une zone est aussi tenue pour périmée
 * si elle n'a pas été vérifiée depuis une semaine — les commerces changent
 * dans OSM sans que le rendu des tuiles bouge.
 */
export async function checkFreshness(): Promise<Freshness> {
  const regions = await listRegions();
  const now = Date.now();
  let latest: string | null = null;
  try {
    latest = versionOf(await resolveVectorTemplate());
  } catch {
    // Hors ligne : on ne peut rien affirmer, et surtout pas que c'est périmé.
    return { latest: null, stale: [], checkedAt: now };
  }

  const stale = regions.filter(
    (r) =>
      r.status === "ready" &&
      (r.tileVersion !== latest || now - r.updatedAt > CONFIG.OFFLINE.REFRESH_AFTER_MS),
  );
  for (const region of regions) await putRegion({ ...region, checkedAt: now });
  return { latest, stale, checkedAt: now };
}

/** Vrai si l'intervalle de vérification choisi est écoulé. */
export function isCheckDue(regions: OfflineRegion[], interval = CONFIG.OFFLINE.REFRESH_AFTER_MS): boolean {
  if (!regions.length || !Number.isFinite(interval)) return false;
  const last = Math.max(...regions.map((r) => r.checkedAt));
  return Date.now() - last > interval;
}

// --- Lecture ---------------------------------------------------------------

/**
 * Les détails d'un lieu, pris dans une zone téléchargée.
 *
 * Rendus **en priorité sur le réseau** quand ils existent : ils sont déjà là,
 * et la fiche s'ouvre instantanément au lieu d'attendre Overpass.
 */
export async function getOfflineDetails(id: string): Promise<PlaceDetails | null> {
  try {
    const stored = await getStoredPlace(id);
    if (!stored) return null;
    return {
      address: stored.address,
      openingHours: stored.openingHours,
      phone: stored.phone,
      website: stored.website,
    };
  } catch {
    return null;
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Recherche dans les zones téléchargées. Rend la même forme que Photon.
 *
 * Un **numéro en tête de requête** est mis de côté avant l'interrogation de
 * l'index : « 12 rue de Rivoli » cherche la voie, puis retrouve le 12 dans la
 * liste des numéros qu'elle porte. C'est ce qui permet de n'indexer que les
 * voies — 6 000 pour Paris intra-muros au lieu de 200 000 numéros — sans
 * perdre la position exacte.
 */
export async function searchOffline(query: string, limit = 8): Promise<Place[]> {
  const houseNumber = /^\s*(\d+\s*(?:bis|ter|quater)?)\b/i.exec(query)?.[1]?.trim();
  const words = normalize(houseNumber ? query.slice(houseNumber.length) : query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  if (!words.length) return [];
  try {
    const entries = await searchEntries(words, limit * 4);
    return entries.slice(0, limit).map((e) => {
      const exact = houseNumber
        ? e.numbers?.find((n) => normalize(n.n) === normalize(houseNumber))
        : undefined;
      return {
        id: e.id.slice(e.id.indexOf(":") + 1),
        name: exact ? `${exact.n} ${e.label}` : e.label,
        group: e.group as FilterGroupId | null,
        rawType: e.rawType,
        lon: exact?.lon ?? e.lon,
        lat: exact?.lat ?? e.lat,
        address: e.sub,
      };
    });
  } catch {
    return [];
  }
}

