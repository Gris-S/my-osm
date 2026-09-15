// ---------------------------------------------------------------------------
// Cache persistant de la couche transport (IndexedDB).
//
// Pour ce qui vit des jours — les arrêts d'une tuile, sept jours — et doit
// survivre au redémarrage de l'application : sans lui, chaque lancement
// redemanderait à Transitous les arrêts du quartier. Des données publiques
// seulement, rien de l'utilisateur ; rien ne quitte l'appareil.
//
// Tout échec (navigation privée, stockage plein, absence d'IndexedDB dans les
// tests) vaut « pas en cache » : ce cache accélère, il ne conditionne rien.
// ---------------------------------------------------------------------------

const DB_NAME = "osm-local:transport-cache";
const STORE = "entries";

interface Entry {
  value: unknown;
  expiresAt: number;
}

let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const db = request.result;
        purgeExpired(db);
        resolve(db);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** Une fois par session : les entrées échues partent, le cache ne grossit pas indéfiniment. */
function purgeExpired(db: IDBDatabase): void {
  try {
    const now = Date.now();
    const cursor = db.transaction(STORE, "readwrite").objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      if ((current.value as Entry).expiresAt <= now) current.delete();
      current.continue();
    };
  } catch {
    /* sans purge, les entrées échues sont simplement ignorées à la lecture */
  }
}

export async function readPersistent<T>(key: string): Promise<T | undefined> {
  const db = await database();
  if (!db) return undefined;
  return new Promise<T | undefined>((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result as Entry | undefined;
        resolve(entry && entry.expiresAt > Date.now() ? (entry.value as T) : undefined);
      };
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function writePersistent(key: string, value: unknown, ttlMs: number): Promise<void> {
  const db = await database();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ value, expiresAt: Date.now() + ttlMs } satisfies Entry, key);
  } catch {
    /* stockage plein ou refusé : la prochaine lecture repassera par le réseau */
  }
}
