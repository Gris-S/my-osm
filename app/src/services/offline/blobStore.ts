// ---------------------------------------------------------------------------
// Où vivent physiquement les tuiles téléchargées.
//
// Trois implantations derrière une même interface, et le choix se fait au
// démarrage :
//
//   - **OPFS** (`navigator.storage.getDirectory()`) : un vrai système de
//     fichiers privé à l'origine, rangé par dossiers. C'est l'implantation
//     préférée — les octets ne sont plus mêlés à quoi que ce soit qui porte le
//     nom de « cache », et un système de fichiers encaisse bien mieux des
//     centaines de milliers de fichiers qu'un magasin clé-valeur.
//   - **Cache Storage** : le repli, si OPFS manque ou refuse. Il marchait déjà,
//     il continue de marcher. Une zone téléchargée avant la bascule reste
//     lisible : la lecture consulte les deux.
//
//   - **l'appareil** (`deviceStore.ts`), dans l'APK : le stockage interne de
//     l'application, par `@capacitor/filesystem`. Il passe devant les deux
//     autres, qui appartiennent à la WebView.
//
// **Pourquoi l'appareil dans l'APK.** OPFS, Cache Storage et IndexedDB sont
// « best-effort » : mesuré sur le Pixel 8, `navigator.storage.persisted()` rend
// faux et la demande de persistance est refusée — le système peut les vider
// quand la place manque, et une carte téléchargée pour un voyage disparaîtrait
// sans prévenir. Le stockage de l'application ne part qu'à la désinstallation
// ou par « Effacer les données ». Dans un navigateur, rien de tel n'existe.
//
// Ce module est **partagé avec le Service Worker** : rien ici ne doit supposer
// une fenêtre.
// ---------------------------------------------------------------------------

import { CONFIG } from "../../config";
import { deviceFilesystem, makeDeviceStore } from "./deviceStore";

export interface BlobStore {
  readonly name: "opfs" | "cache" | "device";
  has(path: string): Promise<boolean>;
  put(path: string, blob: Blob): Promise<void>;
  get(path: string): Promise<Blob | undefined>;
  /** Retire tout ce que `keep` ne contient pas. */
  prune(keep: Set<string>): Promise<void>;
}

/** Pourquoi une écriture a échoué : la place, ou autre chose. */
export type WriteFailure = "storage-full" | "write";

/**
 * Une écriture refusée pendant un téléchargement. La zone s'arrête et dit
 * pourquoi : avant, l'échec était avalé tuile par tuile, et une zone « prête »
 * pouvait être trouée sans que rien ne le signale.
 */
export class StorageWriteError extends Error {
  readonly reason: WriteFailure;
  constructor(reason: WriteFailure, cause?: unknown) {
    super(reason === "storage-full" ? "Stockage plein" : "Écriture impossible", { cause });
    this.name = "StorageWriteError";
    this.reason = reason;
  }
}

/** Sous cette place libre, un refus d'écrire est tenu pour un stockage plein. */
export const STORAGE_FULL_MARGIN_BYTES = 20_000_000;

/** Vrai pour l'erreur de quota des API web (IndexedDB, OPFS, Cache Storage). */
export function isQuotaError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError";
}

/**
 * Stockage plein, ou autre refus ? Le greffon Android rend une erreur générique
 * (« 'writeFile' failed with: … »), sans code propre au disque plein : la place
 * libre mesurée au moment de l'échec tranche.
 */
export function classifyWriteFailure(error: unknown, freeBytes: number | null): WriteFailure {
  if (isQuotaError(error)) return "storage-full";
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOSPC|no space left/i.test(message)) return "storage-full";
  return freeBytes !== null && freeBytes < STORAGE_FULL_MARGIN_BYTES ? "storage-full" : "write";
}

/** `https://hors-ligne.local/vector/14/8298/5637` → `vector/14/8298/5637`. */
export function pathOf(key: string): string {
  return key.replace("https://hors-ligne.local/", "");
}

/**
 * Une ressource d'habillage (style, pictogrammes, polices) rangée par son URL.
 * Le nom de fichier est l'URL échappée : long, mais univoque et réversible.
 *
 * L'URL est **normalisée d'abord** (`new URL(…).href`) : MapLibre demande les
 * polices avec des espaces nus (`fonts/Noto Sans Regular/0-255.pbf`), le
 * téléchargement les écrit encodés (`Noto%20Sans%20Regular`). Sans cela, les
 * deux ne tombaient jamais sur le même fichier — constaté hors ligne sur le
 * téléphone : les polices étaient là, et la carte n'affichait aucun nom.
 */
export function assetPath(url: string): string {
  let normalized = url;
  try {
    normalized = new URL(url).href;
  } catch {
    // Adresse illisible : rangée telle quelle.
  }
  return `assets/${encodeURIComponent(normalized)}`;
}

// --- OPFS -------------------------------------------------------------------

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle("zones", { create: true });
  } catch {
    return null;
  }
}

/**
 * Descend l'arborescence jusqu'au dossier parent d'un chemin.
 *
 * Les tuiles sont rangées `kind/z/x/y` et non à plat : un dossier OPFS de
 * plusieurs centaines de milliers d'entrées devient lent à parcourir, alors
 * qu'une arborescence garde chaque niveau court.
 */
async function dirFor(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

function makeOpfsStore(root: FileSystemDirectoryHandle): BlobStore {
  const split = (path: string) => {
    const parts = path.split("/");
    return { dirs: parts.slice(0, -1), file: parts[parts.length - 1] };
  };

  return {
    name: "opfs",
    async has(path) {
      const { dirs, file } = split(path);
      const dir = await dirFor(root, dirs, false);
      if (!dir) return false;
      try {
        await dir.getFileHandle(file);
        return true;
      } catch {
        return false;
      }
    },
    async put(path, blob) {
      const { dirs, file } = split(path);
      const dir = await dirFor(root, dirs, true);
      if (!dir) throw new Error("Dossier hors ligne indisponible");
      const handle = await dir.getFileHandle(file, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    async get(path) {
      const { dirs, file } = split(path);
      const dir = await dirFor(root, dirs, false);
      if (!dir) return undefined;
      try {
        return await (await dir.getFileHandle(file)).getFile();
      } catch {
        return undefined;
      }
    },
    async prune(keep) {
      // Parcours en profondeur : on efface les fichiers absents de `keep`, puis
      // les dossiers devenus vides — sans quoi l'arborescence d'une zone
      // supprimée resterait indéfiniment, vide mais présente.
      const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<number> => {
        let remaining = 0;
        const entries: [string, FileSystemHandle][] = [];
        for await (const entry of dir.entries()) entries.push(entry);
        for (const [name, handle] of entries) {
          const path = prefix ? `${prefix}/${name}` : name;
          // Un dossier entier peut être épargné d'un coup — c'est le cas de
          // `assets`, dont les polices et pictogrammes ne s'énumèrent pas sans
          // relire le style, et qui sert à toutes les zones.
          if (keep.has(path)) {
            remaining++;
            continue;
          }
          if (handle.kind === "directory") {
            const left = await walk(handle as FileSystemDirectoryHandle, path);
            if (left === 0) await dir.removeEntry(name, { recursive: true });
            else remaining += left;
          } else if (keep.has(path)) {
            remaining++;
          } else {
            await dir.removeEntry(name);
          }
        }
        return remaining;
      };
      await walk(root, "");
    },
  };
}

// --- Cache Storage (repli) --------------------------------------------------

function makeCacheStore(): BlobStore {
  const open = () => caches.open(CONFIG.OFFLINE.CACHE_NAME);
  const url = (path: string) => `https://hors-ligne.local/${path}`;
  return {
    name: "cache",
    async has(path) {
      return (await (await open()).match(url(path))) !== undefined;
    },
    async put(path, blob) {
      await (await open()).put(url(path), new Response(blob));
    },
    async get(path) {
      const res = await (await open()).match(url(path));
      return res ? await res.blob() : undefined;
    },
    async prune(keep) {
      const cache = await open();
      for (const key of await cache.keys()) {
        const path = pathOf(key.url);
        if (keep.has(path) || keep.has(path.split("/")[0])) continue;
        await cache.delete(key);
      }
    },
  };
}

let storePromise: Promise<BlobStore> | null = null;

/** Le magasin en vigueur : l'appareil dans l'APK, OPFS s'il existe, Cache Storage sinon. */
export function tileStore(): Promise<BlobStore> {
  storePromise ??= (async () => {
    const device = deviceFilesystem();
    if (device) return makeDeviceStore(device);
    const root = await opfsRoot();
    return root ? makeOpfsStore(root) : makeCacheStore();
  })();
  return storePromise;
}

/**
 * Lit dans OPFS **puis** dans le Cache Storage.
 *
 * Les zones téléchargées avant la bascule vivent encore dans l'ancien magasin :
 * les ignorer les rendrait invisibles du jour au lendemain, sans que rien ne
 * l'explique. Elles restent lisibles, et se rangeront dans OPFS à la première
 * mise à jour.
 */
export async function readAnywhere(path: string): Promise<Blob | undefined> {
  const store = await tileStore();
  const found = await store.get(path);
  if (found) return found;
  if (store.name === "opfs") {
    try {
      const res = await (await caches.open(CONFIG.OFFLINE.CACHE_NAME)).match(
        `https://hors-ligne.local/${path}`,
      );
      if (res) return await res.blob();
    } catch {
      /* pas d'ancien magasin */
    }
  }
  return undefined;
}
