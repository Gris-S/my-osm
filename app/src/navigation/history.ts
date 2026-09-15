import type { LonLat } from "../types";
import type { ElevationSample } from "./elevation";
import type { StepSource } from "./useStepCounter";
import { retentionCutoff } from "./settings";

// ---------------------------------------------------------------------------
// L'historique des trajets à pied.
//
// **IndexedDB et non `localStorage`**, contrairement aux autres réglages du
// projet : un trajet porte son tracé, quelques centaines de points, et son
// profil de dénivelé — deux à dix kilo-octets pièce. Le quota de
// `localStorage` (cinq mégaoctets pour toute l'origine, partagés avec les
// signets, l'historique de recherche et le reste) serait atteint en quelques
// centaines de marches, et son écriture est synchrone : elle bloquerait le fil
// principal au moment précis où l'on vient d'arriver.
//
// La base porte son propre nom, distinct de celle des cartes hors ligne :
// supprimer le dossier `src/navigation/` laisse une base orpheline que le
// navigateur nettoiera avec le reste des données du site, sans gêner personne.
// Cent lignes de promesses autour d'IndexedDB, sans dépendance, comme
// `services/offline/store.ts`.
// ---------------------------------------------------------------------------

const DB_NAME = "osm-local:navigation-history";
const DB_VERSION = 1;
const STORE = "trips";

/**
 * Un relevé de course (voir `running/`). Noms d'une lettre : une heure de course
 * en compte 1 800, et ils vivent dans IndexedDB.
 */
export interface RunSample {
  /** Secondes de course depuis le départ, pauses exclues. */
  t: number;
  /** Mètres parcourus depuis le départ. */
  d: number;
  /** Vitesse mesurée, en m/s ; `null` si l'appareil ne l'a pas donnée. */
  v: number | null;
  /** Tronçon : il change à chaque reprise après une pause. */
  s: number;
}

/** Un trajet terminé, tel qu'il est gardé. */
export interface Trip {
  id: string;
  startedAt: number;
  endedAt: number;
  /** Le point de départ, sous le nom qu'il portait dans le parcours. */
  from: string;
  /** L'arrivée. C'est elle qui nomme le trajet dans la liste. */
  to: string;
  /** Distance réellement parcourue le long du tracé suivi, en mètres. */
  distanceMeters: number;
  /** Temps écoulé du départ à l'arrêt, montre en main. */
  elapsedSeconds: number;
  /**
   * Ce que le moteur annonçait **pour cette portion-là**, et non pour le trajet
   * entier : s'arrêter à mi-chemin doit se comparer à la moitié annoncée, pas
   * au tout. Voir `useNavigation`, qui l'accumule au fil des recalculs.
   */
  announcedSeconds: number;
  /** Pas comptés, et d'où vient le chiffre. */
  steps: number;
  stepSource: StepSource;
  /** Le tracé effectivement parcouru. */
  points: LonLat[];
  /** Profil du dénivelé, calculé à l'arrivée ; `null` s'il a manqué. */
  profile: ElevationSample[] | null;
  ascent: number | null;
  descent: number | null;
  /** Vrai si l'on est arrivé, faux si le trajet a été interrompu en route. */
  completed: boolean;
  /**
   * La nature de l'activité. Absent des trajets enregistrés avant le mode
   * course : ce sont des marches.
   */
  kind?: "walk" | "run";
  /** Course seulement : les relevés, pour le graphe de l'allure. */
  samples?: RunSample[];
  /** Course seulement : le temps passé en pause, exclu de `elapsedSeconds`. */
  pausedSeconds?: number;
}

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // La liste se lit de la plus récente à la plus ancienne, et la purge
        // par ancienneté balaie la même clé : un seul index sert aux deux.
        store.createIndex("endedAt", "endedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // Une base injoignable — mode privé, quota refusé — ne doit pas empêcher de
  // réessayer plus tard : on oublie la promesse échouée.
  handle.catch(() => {
    handle = null;
  });
  return handle;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/** Enregistre un trajet. Le même identifiant écrase : c'est ce qui permet d'y
 *  ajouter le profil du dénivelé une fois qu'il a été lu. */
export async function saveTrip(trip: Trip): Promise<void> {
  await run("readwrite", (store) => store.put(trip));
}

/** Les trajets gardés, du plus récent au plus ancien. */
export async function listTrips(): Promise<Trip[]> {
  const all = await run<Trip[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.endedAt - a.endedAt);
}

export async function deleteTrips(ids: string[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const id of ids) store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Applique le réglage de conservation : efface ce qui a dépassé son terme.
 *
 * Elle est appelée à l'ouverture de l'historique **et** avant chaque
 * enregistrement, plutôt qu'à un moment fixe : l'application n'a pas de tâche
 * de fond, et une purge qui ne s'exécuterait qu'au démarrage laisserait vivre
 * indéfiniment les trajets d'une session qu'on ne referme jamais.
 *
 * Rend le nombre de trajets effacés.
 */
export async function purgeTrips(): Promise<number> {
  const cutoff = retentionCutoff();
  if (cutoff === null) return 0;
  const trips = await listTrips();
  const stale = trips.filter((trip) => trip.endedAt < cutoff).map((trip) => trip.id);
  if (stale.length) await deleteTrips(stale);
  return stale.length;
}

/** Efface tout l'historique — le choix « ne jamais enregistrer » le fait. */
export async function clearTrips(): Promise<void> {
  await run("readwrite", (store) => store.clear());
}
