// ---------------------------------------------------------------------------
// Les cartes hors ligne rangées **dans l'application**, et non dans la WebView.
//
// Dans l'APK, OPFS, le Cache Storage et IndexedDB appartiennent à la WebView,
// dont le stockage est « best-effort » : mesuré sur le Pixel 8,
// `navigator.storage.persisted()` rend faux et la demande de persistance est
// refusée. Le système peut donc le vider quand la place manque — effacer une
// carte téléchargée pour un voyage, sans prévenir. Le stockage interne de
// l'application (`Directory.Data`) n'est vidé qu'à la désinstallation, ou par
// « Effacer les données » dans les réglages d'Android.
//
// - **Écriture** par le greffon officiel `@capacitor/filesystem`, en base64 :
//   c'est la seule forme binaire que sa version Android accepte.
// - **Lecture** par l'adresse locale que Capacitor sert directement depuis le
//   disque (`convertFileSrc`, `/_capacitor_file_/…`) : un `fetch` ordinaire,
//   sans faire passer les octets par le pont JavaScript. Un fichier absent y
//   rend un 404 immédiat (vérifié dans `WebViewLocalServer`), et la carte
//   retombe aussitôt sur le réseau.
// - **Suppression** par dossiers entiers dès qu'aucune tuile gardée n'y vit :
//   un appel au pont par fichier serait interminable sur une grande zone.
//
// La page n'importe pas `@capacitor/core` (voir `services/native.ts`) : le
// greffon est atteint par `Capacitor.Plugins`. Ce module est aussi chargé par le
// Service Worker d'un navigateur — rien n'y suppose une fenêtre, et hors APK
// `deviceFilesystem()` rend `null`.
// ---------------------------------------------------------------------------

import type { BlobStore } from "./blobStore";

/** Le dossier des tuiles et de l'habillage, dans le stockage de l'application. */
export const DEVICE_ZONES_DIR = "zones";

/** `Directory.Data` du greffon : le stockage interne, privé à l'application. */
export const DEVICE_DIRECTORY = "DATA";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
}

/** Le strict nécessaire du greffon `Filesystem`, tel que la page l'atteint. */
export interface DeviceFilesystem {
  getUri(options: { path: string; directory: string }): Promise<{ uri: string }>;
  writeFile(options: {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
    encoding?: "utf8";
  }): Promise<unknown>;
  readFile(options: { path: string; directory: string; encoding?: "utf8" }): Promise<{ data: string | Blob }>;
  deleteFile(options: { path: string; directory: string }): Promise<void>;
  rmdir(options: { path: string; directory: string; recursive?: boolean }): Promise<void>;
  readdir(options: { path: string; directory: string }): Promise<{ files: FileEntry[] }>;
  stat(options: { path: string; directory: string }): Promise<FileEntry>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  convertFileSrc?: (path: string) => string;
  Plugins?: Record<string, unknown>;
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** Le greffon, dans l'APK seulement ; `null` dans un navigateur ou un Service Worker. */
export function deviceFilesystem(): DeviceFilesystem | null {
  const cap = capacitor();
  if (cap?.isNativePlatform?.() !== true || typeof cap.convertFileSrc !== "function") return null;
  return (cap.Plugins?.Filesystem as DeviceFilesystem | undefined) ?? null;
}

/**
 * Octets libres sur le stockage de l'application (greffon `DeviceStorage`,
 * propre à l'APK), ou `null` hors APK. `navigator.storage.estimate()` ne
 * convient pas : il parle du quota de la WebView, pas du disque.
 */
export async function deviceFreeBytes(): Promise<number | null> {
  const plugin = capacitor()?.Plugins?.DeviceStorage as { free(): Promise<{ bytes: number }> } | undefined;
  if (!plugin) return null;
  try {
    const { bytes } = await plugin.free();
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * L'adresse locale d'un fichier du magasin. **Chaque segment est échappé** :
 * l'habillage est rangé sous son URL échappée (`assets/https%3A…`, voir
 * `assetPath`), et le serveur de Capacitor décode l'adresse avant d'ouvrir le
 * fichier — sans ce second échappement, il chercherait `assets/https:/…`.
 */
export function deviceFileUrl(base: string, path: string): string {
  return `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Les dossiers qui mènent à au moins un chemin gardé. À la suppression, on ne
 * descend que dans ceux-là ; tout autre dossier part d'un seul appel.
 */
export function keptAncestors(keep: Iterable<string>): Set<string> {
  const ancestors = new Set<string>();
  for (const path of keep) {
    let at = path.indexOf("/");
    while (at !== -1) {
      ancestors.add(path.slice(0, at));
      at = path.indexOf("/", at + 1);
    }
  }
  return ancestors;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Par tranches : `String.fromCharCode(...)` sur une tuile entière dépasserait
  // le nombre d'arguments qu'une fonction accepte.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function makeDeviceStore(fs: DeviceFilesystem): BlobStore {
  const full = (path: string) => (path ? `${DEVICE_ZONES_DIR}/${path}` : DEVICE_ZONES_DIR);

  // L'adresse locale du dossier, lue une fois ; oubliée si la lecture échoue,
  // pour être redemandée à la tuile suivante.
  let base: Promise<string> | null = null;
  const baseUrl = () =>
    (base ??= fs
      .getUri({ path: DEVICE_ZONES_DIR, directory: DEVICE_DIRECTORY })
      .then(({ uri }) => capacitor()!.convertFileSrc!(uri))
      .catch((error: unknown) => {
        base = null;
        throw error;
      }));

  return {
    name: "device",
    async has(path) {
      try {
        await fs.stat({ path: full(path), directory: DEVICE_DIRECTORY });
        return true;
      } catch {
        return false;
      }
    },
    async put(path, blob) {
      await fs.writeFile({
        path: full(path),
        data: await toBase64(blob),
        directory: DEVICE_DIRECTORY,
        recursive: true,
      });
    },
    async get(path) {
      try {
        const res = await fetch(deviceFileUrl(await baseUrl(), path));
        return res.ok ? await res.blob() : undefined;
      } catch {
        return undefined;
      }
    },
    async prune(keep) {
      const ancestors = keptAncestors(keep);
      const remove = async (path: string, directory: boolean) => {
        try {
          if (directory) await fs.rmdir({ path: full(path), directory: DEVICE_DIRECTORY, recursive: true });
          else await fs.deleteFile({ path: full(path), directory: DEVICE_DIRECTORY });
        } catch {
          // Déjà parti, ou refusé : la suppression continue avec le reste.
        }
      };
      const walk = async (dir: string): Promise<number> => {
        let entries: FileEntry[];
        try {
          entries = (await fs.readdir({ path: full(dir), directory: DEVICE_DIRECTORY })).files;
        } catch {
          return 0;
        }
        let remaining = 0;
        for (const entry of entries) {
          const path = dir ? `${dir}/${entry.name}` : entry.name;
          // Un dossier entier peut être épargné d'un coup — c'est le cas de
          // `assets`, commun à toutes les zones.
          if (keep.has(path)) {
            remaining++;
            continue;
          }
          const isDirectory = entry.type === "directory";
          if (isDirectory && ancestors.has(path)) {
            const left = await walk(path);
            if (left === 0) await remove(path, true);
            else remaining += left;
          } else {
            await remove(path, isDirectory);
          }
        }
        return remaining;
      };
      await walk("");
    },
  };
}
