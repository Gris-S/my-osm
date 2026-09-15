// ---------------------------------------------------------------------------
// Le journal de navigation : ce qui s'est passé pendant un trajet, relisible
// après coup.
//
// Il existe parce qu'un trajet où « quelque chose de bizarre » est arrivé ne
// laissait **aucune trace** : l'application n'écrivait rien, et le journal
// d'Android ne garde qu'une minute environ — constaté en voulant analyser une
// navigation voiture. On ne corrige pas ce qu'on ne peut pas relire.
//
// Ce qu'il retient : les calculs et recalculs (et pourquoi), les réévaluations
// du trafic, un relevé GPS résumé toutes les quelques secondes, les erreurs, et
// les passages en arrière-plan — l'écran éteint ou une autre application au
// premier plan interrompent le guidage, et c'est souvent l'explication.
//
// **Il reste sur l'appareil** (`localStorage`), plafonné, et s'écrit par lots :
// une écriture par relevé ferait travailler le stockage chaque seconde. Les lots
// vont dans une **queue** courte (`TAIL_MAX` entrées), versée dans l'archive
// quand elle déborde : réécrire les 5 000 entrées toutes les 5 s pendant la
// navigation, c'était relire et réécrire des centaines de kilo-octets sur le fil
// principal, au milieu du glissement de la carte. Il se
// relit par le câble (`outils/journal.sh`, via le débogage de la WebView :
// `window.__myosm.journal`).
// ---------------------------------------------------------------------------

const STORAGE_KEY = "osm-local:nav-journal";

/** Au-delà, les entrées les plus anciennes partent : quelques trajets, pas un historique. */
const MAX_ENTRIES = 5000;

/** Les entrées attendent au plus cela avant d'être écrites. */
const FLUSH_MS = 5000;

/** Les lots récents, écrits à part ; au-delà, ils rejoignent l'archive. */
const TAIL_KEY = `${STORAGE_KEY}:queue`;
const TAIL_MAX = 500;

export interface JournalEntry {
  /** Horodatage, en millisecondes. */
  t: number;
  /** Nature de l'événement : `car.start`, `car.reroute`, `gps`, `app.hidden`… */
  k: string;
  d?: Record<string, unknown>;
}

let pending: JournalEntry[] = [];
let timer: number | null = null;
let listening = false;
// Ce qui a été lu du stockage, gardé en mémoire : relu une fois, pas à chaque lot.
let archive: JournalEntry[] | null = null;
let tail: JournalEntry[] | null = null;

function load(key: string): JournalEntry[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

function save(key: string, entries: JournalEntry[]) {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Stockage plein ou indisponible : le journal perd ce lot, la navigation
    // n'en souffre pas.
  }
}

function read(): JournalEntry[] {
  archive ??= load(STORAGE_KEY);
  tail ??= load(TAIL_KEY);
  return [...archive, ...tail].slice(-MAX_ENTRIES);
}

function flush() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (!pending.length) return;
  tail = [...(tail ?? load(TAIL_KEY)), ...pending];
  pending = [];
  if (tail.length <= TAIL_MAX) {
    save(TAIL_KEY, tail);
    return;
  }
  // La queue déborde : elle rejoint l'archive, réécrite une fois pour 500 entrées.
  archive = [...(archive ?? load(STORAGE_KEY)), ...tail].slice(-MAX_ENTRIES);
  tail = [];
  save(STORAGE_KEY, archive);
  save(TAIL_KEY, tail);
}

/** L'écran qui s'éteint ou l'application qui passe derrière : noté, et le lot est écrit tout de suite. */
function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    note(document.visibilityState === "hidden" ? "app.hidden" : "app.visible");
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("online", () => note("net.online"));
  window.addEventListener("offline", () => note("net.offline"));
  // Lu par `outils/journal.sh` ; absent de la version release (`__DIAGNOSTICS__`).
  if (__DIAGNOSTICS__) {
    (window as unknown as { __myosm?: Record<string, unknown> }).__myosm = {
      ...(window as unknown as { __myosm?: Record<string, unknown> }).__myosm,
      journal: { read: readJournal, clear: clearJournal },
    };
  }
}

/** Arrondit les nombres d'un détail : un journal lisible, et plus léger. */
function tidy(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    out[key] = typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value;
  }
  return out;
}

/** Note un événement. Ne lève jamais : le journal ne doit rien pouvoir casser. */
export function note(kind: string, data?: Record<string, unknown>): void {
  try {
    listen();
    pending.push({ t: Date.now(), k: kind, d: tidy(data) });
    timer ??= window.setTimeout(flush, FLUSH_MS);
  } catch {
    /* rien */
  }
}

// L'écoute démarre dès le chargement : un passage en arrière-plan entre deux
// trajets explique parfois le suivant, et le journal se relit par le câble sans
// attendre qu'une navigation ait eu lieu.
if (typeof window !== "undefined") {
  listen();
  note("app.start");
}

/** Tout le journal, lot en attente compris. */
export function readJournal(): JournalEntry[] {
  flush();
  return read();
}

export function clearJournal(): void {
  pending = [];
  archive = [];
  tail = [];
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TAIL_KEY);
  } catch {
    /* rien */
  }
}
