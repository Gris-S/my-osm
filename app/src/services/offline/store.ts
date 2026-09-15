// ---------------------------------------------------------------------------
// Stockage des zones hors ligne.
//
// Deux magasins, parce que ce qu'on garde est de deux natures :
//
//   - les **tuiles** vont dans le magasin de `blobStore.ts`, sous une clé
//     normalisée (`keys.ts`) : le stockage de l'application dans l'APK
//     (`deviceStore.ts`), OPFS dans un navigateur.
//   - les **détails de lieux**, les **adresses** et l'**index de recherche**
//     vont dans IndexedDB, parce qu'on les interroge par le texte et non par
//     une URL.
//
// Le tout est délibérément sans dépendance : une centaine de lignes de
// promesses autour d'IndexedDB coûtent moins qu'une bibliothèque de plus dans
// le fragment de démarrage.
// ---------------------------------------------------------------------------

import type { Bbox } from "./tiles";
import type { Area } from "./area";
import { CONFIG } from "../../config";
import { tileStore, type WriteFailure } from "./blobStore";
import { DEVICE_DIRECTORY, deviceFilesystem, deviceFreeBytes, type DeviceFilesystem } from "./deviceStore";

/** Ce que l'utilisateur a demandé en téléchargeant, et ce qu'on en sait. */
export interface OfflineRegion {
  id: string;
  name: string;
  bbox: Bbox;
  /**
   * Le contour exact d'une zone choisie sur la carte (pays, région,
   * département) : tuiles et lieux ne sont pris qu'à l'intérieur. Absent des
   * zones tracées au carré avant les contours, qui suivent leur rectangle.
   */
  area?: Area;
  /** Palier choisi : la carte seule, ou davantage. */
  detail: "map" | "places";
  /**
   * Zoom maximal des tuiles vectorielles. Quatorze est le maximum utile — les
   * tuiles s'y arrêtent — mais un pays entier y pèserait des dizaines de
   * gigaoctets : mesuré, la France fait 51,6 Go au zoom 14 contre 2,4 au 12.
   * D'où un plafond par zone, et non une constante.
   */
  vectorMaxZoom: number;
  /** Pays pris dans l'ancienne liste des pays, retirée — gardé pour les zones déjà prises. */
  countryCode?: string;
  satelliteMaxZoom: number | null;
  /**
   * Zoom maximal des tuiles d'altitude, ou `null` si le relief n'a pas été
   * pris. Même forme que `satelliteMaxZoom` : les deux couches se choisissent
   * et se dosent de la même façon.
   */
  reliefMaxZoom: number | null;
  /**
   * Les adresses ont-elles été demandées ? Distinct de `addressDepts`, qui
   * n'est que le résultat de la détection : au moment où l'on lance, celle-ci
   * peut ne pas avoir abouti, et une liste vide ne doit pas se confondre avec
   * un refus.
   */
  addresses: boolean;
  /** Départements identifiés sous l'emprise, une fois connus. */
  addressDepts: string[];
  createdAt: number;
  updatedAt: number;
  /**
   * Version des tuiles au moment du téléchargement — la partie datée de l'URL
   * d'OpenFreeMap (`20260830_080001_pt`). C'est le seul moyen gratuit de
   * savoir si la zone est périmée : on relit le TileJSON et on compare.
   */
  tileVersion: string;
  /** Dernière vérification de fraîcheur, réussie ou non. */
  checkedAt: number;
  /** Poids réellement écrit, en octets — pas l'estimation. */
  bytes: number;
  tilesDone: number;
  tilesTotal: number;
  placesCount: number;
  addressCount: number;
  status: "pending" | "downloading" | "ready" | "paused" | "error";
  /**
   * Qui a interrompu. Distinction indispensable : seules les pauses décidées
   * par l'application — connexion perdue, passage en données mobiles — se
   * reprennent toutes seules. Une interruption demandée par l'utilisateur doit
   * le rester.
   */
  pausedBy?: "user" | "system";
  error?: string;
  /**
   * Pourquoi la zone attend, quand ce n'est pas le réseau : `storage-full`
   * (plus de place), `write` (écriture refusée), `moved` (les cartes sont
   * désormais rangées dans l'application : la zone est à retélécharger).
   * Une clé et non une phrase, traduite à l'affichage.
   */
  failure?: WriteFailure | "moved";
}

/** Une entrée de l'index de recherche hors ligne. */
export interface SearchEntry {
  id: string;
  region: string;
  label: string;
  sub: string;
  lon: number;
  lat: number;
  group: string | null;
  rawType?: string;
  /** Mots normalisés du libellé, pour la recherche par préfixe. */
  terms: string[];
  /**
   * Pour une voie : ses numéros et leurs positions. Les adresses sont
   * regroupées par voie plutôt qu'indexées une par une — Paris intra-muros,
   * c'est 200 000 numéros pour 6 000 voies.
   */
  numbers?: { n: string; lon: number; lat: number }[];
}

/** Les détails d'un lieu, tels que la fiche les attend. */
export interface StoredPlaceDetails {
  id: string;
  region: string;
  address?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
}

const DB_NAME = "osm-local-hors-ligne";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("regions")) db.createObjectStore("regions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("places")) {
        const s = db.createObjectStore("places", { keyPath: "id" });
        s.createIndex("region", "region");
      }
      if (!db.objectStoreNames.contains("search")) {
        const s = db.createObjectStore("search", { keyPath: "id" });
        s.createIndex("region", "region");
        // `multiEntry` indexe chaque mot séparément : c'est lui qui rend la
        // recherche par préfixe possible sans parcourir tout le magasin.
        s.createIndex("terms", "terms", { multiEntry: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: IDBObjectStore | IDBIndex, req: IDBRequest<T>): Promise<T> {
  void store;
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(names: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
  const db = await openDb();
  return db.transaction(names, mode);
}

// --- Zones -----------------------------------------------------------------

// Change à chaque écriture ou suppression d'une zone : la carte relit la liste
// des zones dès qu'elle bouge, au lieu d'attendre sa relecture périodique — une
// zone qu'on vient de télécharger doit servir tout de suite.
let regionsRevision = 0;

/** Le numéro de la dernière modification de la liste des zones. */
export function regionsRevisionNumber(): number {
  return regionsRevision;
}

export async function listRegions(): Promise<OfflineRegion[]> {
  const t = await tx(["regions"], "readonly");
  const s = t.objectStore("regions");
  const all = await run(s, s.getAll() as IDBRequest<OfflineRegion[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putRegion(region: OfflineRegion): Promise<void> {
  const t = await tx(["regions"], "readwrite");
  const s = t.objectStore("regions");
  await run(s, s.put(region));
  regionsRevision += 1;
  scheduleMirror();
}

// --- Détails de lieux et index de recherche --------------------------------

export async function putPlaces(items: StoredPlaceDetails[]): Promise<void> {
  if (!items.length) return;
  const t = await tx(["places"], "readwrite");
  const s = t.objectStore("places");
  for (const item of items) s.put(item);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function getStoredPlace(id: string): Promise<StoredPlaceDetails | undefined> {
  const t = await tx(["places"], "readonly");
  const s = t.objectStore("places");
  return run(s, s.get(id) as IDBRequest<StoredPlaceDetails | undefined>);
}

export async function putSearchEntries(items: SearchEntry[]): Promise<void> {
  if (!items.length) return;
  const t = await tx(["search"], "readwrite");
  const s = t.objectStore("search");
  for (const item of items) s.put(item);
  await new Promise<void>((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

/**
 * Recherche par préfixe sur le premier mot, puis filtrage sur les suivants.
 *
 * L'index `terms` est parcouru sur une plage bornée (`préfixe` →
 * `préfixe￿`), ce qui évite de lire tout le magasin : sur une zone de la
 * taille de Paris il y a des centaines de milliers d'entrées, et un parcours
 * complet à chaque frappe rendrait la barre de recherche inutilisable.
 */
export async function searchEntries(words: string[], limit: number): Promise<SearchEntry[]> {
  if (!words.length) return [];
  const [first, ...rest] = words;
  const t = await tx(["search"], "readonly");
  const index = t.objectStore("search").index("terms");
  const range = IDBKeyRange.bound(first, first + "￿", false, false);
  const seen = new Set<string>();
  const out: SearchEntry[] = [];

  await new Promise<void>((resolve, reject) => {
    const req = index.openCursor(range);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) return resolve();
      const entry = cursor.value as SearchEntry;
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        if (rest.every((w) => entry.terms.some((term) => term.startsWith(w)))) out.push(entry);
      }
      cursor.continue();
    };
  });
  return out;
}

// --- Suppression -----------------------------------------------------------

async function deleteByRegion(
  storeName: "places" | "search",
  regionId: string,
): Promise<void> {
  const t = await tx([storeName], "readwrite");
  const index = t.objectStore(storeName).index("region");
  await new Promise<void>((resolve, reject) => {
    const req = index.openCursor(IDBKeyRange.only(regionId));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      cursor.delete();
      cursor.continue();
    };
  });
}

/**
 * Supprime une zone : ses lignes IndexedDB, puis ses tuiles.
 *
 * Les tuiles ne sont retirées du cache que si **aucune autre zone** ne les
 * réclame — deux zones voisines partagent forcément leurs tuiles de zoom
 * faible, et supprimer l'une ne doit pas crever l'autre.
 */
export async function deleteRegion(id: string, keep: Set<string>): Promise<void> {
  await deleteByRegion("places", id);
  await deleteByRegion("search", id);

  await (await tileStore()).prune(keep);

  const t = await tx(["regions"], "readwrite");
  const s = t.objectStore("regions");
  await run(s, s.delete(id));
  regionsRevision += 1;
  scheduleMirror();
}

// --- Persistance et place --------------------------------------------------

/**
 * Demande au navigateur de **ne pas** évincer ce qu'on vient de télécharger.
 *
 * Sans cela, le stockage d'une origine est « best-effort » : le système peut
 * le vider quand l'espace manque, et une carte téléchargée avant un voyage
 * disparaîtrait précisément quand elle sert. La demande peut être refusée —
 * c'est au navigateur d'en décider — d'où la valeur rendue. La WebView de l'APK
 * la refuse (mesuré) : c'est pourquoi les tuiles y vont dans le stockage de
 * l'application, qui n'a rien à demander.
 */
export async function requestPersistence(): Promise<boolean> {
  if (deviceFilesystem()) return true;
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Nom du magasin en vigueur, pour le dire dans l'interface. */
export async function storeName(): Promise<"opfs" | "cache" | "device"> {
  return (await tileStore()).name;
}

/**
 * Place occupée et place totale. Dans l'APK : le poids écrit des zones, et ce
 * qui reste libre sur le disque. Dans un navigateur : son estimation du quota.
 */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (deviceFilesystem()) {
    const free = await deviceFreeBytes();
    if (free === null) return null;
    const usage = (await listRegions()).reduce((sum, region) => sum + region.bytes, 0);
    return { usage, quota: usage + free };
  }
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/** Place libre pour de nouvelles zones : le disque dans l'APK, le quota restant ailleurs. */
export async function freeBytes(): Promise<number | null> {
  const device = await deviceFreeBytes();
  if (device !== null) return device;
  const estimate = await storageEstimate();
  return estimate ? Math.max(0, estimate.quota - estimate.usage) : null;
}

// --- Stockage de l'appareil (APK) -------------------------------------------
//
// **La liste des zones est recopiée à côté des tuiles**, dans le stockage de
// l'application. Elle vit dans IndexedDB, c'est-à-dire dans la WebView : si le
// système vide celle-ci, les tuiles survivent mais plus rien ne dit qu'elles
// existent — elles seraient invisibles et prendraient la place pour rien. La
// copie les fait revenir au lancement suivant.

/** À la racine du stockage de l'application, hors du dossier que la suppression parcourt. */
const MIRROR_PATH = "zones-regions.json";

/** Les écritures d'avancement tombent toutes les 40 tuiles : la copie les regroupe. */
const MIRROR_DELAY_MS = 1500;

let mirrorTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMirror(): void {
  if (!deviceFilesystem()) return;
  if (mirrorTimer !== null) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    void writeMirror();
  }, MIRROR_DELAY_MS);
}

async function writeMirror(): Promise<void> {
  const fs = deviceFilesystem();
  if (!fs) return;
  try {
    await fs.writeFile({
      path: MIRROR_PATH,
      data: JSON.stringify(await listRegions()),
      directory: DEVICE_DIRECTORY,
      encoding: "utf8",
    });
  } catch {
    // La copie sera refaite à la prochaine écriture d'une zone.
  }
}

/** La copie de la liste : `null` si elle n'existe pas, vide si elle est illisible. */
async function readMirror(fs: DeviceFilesystem): Promise<OfflineRegion[] | null> {
  try {
    const { data } = await fs.readFile({ path: MIRROR_PATH, directory: DEVICE_DIRECTORY, encoding: "utf8" });
    const parsed: unknown = JSON.parse(typeof data === "string" ? data : await data.text());
    return Array.isArray(parsed)
      ? (parsed as OfflineRegion[]).filter((region) => region && typeof region.id === "string")
      : [];
  } catch {
    try {
      await fs.stat({ path: MIRROR_PATH, directory: DEVICE_DIRECTORY });
      return []; // elle existe mais ne se lit pas : ce n'est pas un premier lancement
    } catch {
      return null;
    }
  }
}

/**
 * Une zone qui revient de la copie. Ses tuiles sont là, mais ses détails de
 * lieux et son index de recherche vivaient dans la WebView : elle est tenue
 * pour périmée, et sa mise à jour les refait. Un téléchargement en cours au
 * moment de l'effacement reprend à la main.
 */
function restoredRegion(region: OfflineRegion): OfflineRegion {
  const unfinished = region.status !== "ready";
  return {
    ...region,
    status: unfinished ? "paused" : "ready",
    pausedBy: unfinished ? "user" : region.pausedBy,
    tileVersion: "",
    checkedAt: 0,
  };
}

/** Les copies de tuiles de l'ancienne implantation, dans la WebView. */
async function clearBrowserTileCopies(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("zones", { recursive: true });
  } catch {
    // Rien à effacer.
  }
  try {
    await caches.delete(CONFIG.OFFLINE.CACHE_NAME);
  } catch {
    // Idem.
  }
}

/**
 * À lancer au démarrage de l'APK. Rend vrai si la liste des zones a changé.
 *
 * - **Premier lancement avec le stockage de l'appareil** (aucune copie de la
 *   liste) : les tuiles rangées dans la WebView sont effacées, et chaque zone
 *   passe « à retélécharger » — choix explicite, plutôt qu'une recopie.
 * - **WebView vidée** (liste vide, copie pleine) : les zones reviennent.
 */
export async function prepareDeviceStorage(): Promise<boolean> {
  const fs = deviceFilesystem();
  if (!fs) return false;
  const mirror = await readMirror(fs);
  const regions = await listRegions().catch(() => [] as OfflineRegion[]);

  if (mirror === null) {
    for (const region of regions) {
      await putRegion({
        ...region,
        status: "paused",
        pausedBy: "user",
        failure: "moved",
        tilesDone: 0,
        bytes: 0,
        updatedAt: Date.now(),
      });
    }
    await clearBrowserTileCopies();
    await writeMirror();
    return regions.length > 0;
  }

  if (regions.length === 0 && mirror.length > 0) {
    for (const region of mirror) await putRegion(restoredRegion(region));
    return true;
  }
  return false;
}
