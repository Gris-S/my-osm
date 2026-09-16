import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// La musique en cours, pendant la navigation.
//
// Lue par un greffon natif propre à l'application
// (`apk/android/.../NowPlayingPlugin.java`), qui voit **tout** lecteur publiant
// une session média — YouTube Music, Qobuz, Spotify, un podcast — sans rien
// connaître de lui. Dans un navigateur, le greffon est absent : pas d'encart,
// jamais d'erreur.
//
// C'est un **magasin de module** : l'encart des trois navigations s'y abonne,
// et **l'écoute native ne tourne que tant qu'un abonné existe**, c'est-à-dire
// pendant une navigation. Rien n'est demandé au téléphone le reste du temps.
//
// Le magasin tient deux choses : le morceau en cours, et **l'état de l'accès**
// qu'Android exige (« Accès aux notifications »). Le second sert à l'encart à
// dire qu'on peut l'activer dans les paramètres, plutôt que de rester muet.
//
// Le proxy que le pont natif pose sur `window.Capacitor.Plugins` ne rend pas
// toujours des promesses (mesuré sur Pixel 8 avec le greffon de luminosité) :
// tout passe par `Promise.resolve`, et aucune erreur du greffon ne remonte.
// ---------------------------------------------------------------------------

export interface NowPlayingTrack {
  title: string;
  artist: string;
  album: string;
  /** Le lecteur, tel qu'Android le nomme (« YouTube Music », « Qobuz »). */
  app: string;
  /**
   * Le nom de paquet du lecteur (`com.google.android.apps.youtube.music`).
   *
   * C'est lui, et non le libellé, qui permet de **l'ouvrir** d'un doigt sur la
   * pochette : un nom affichable ne désigne rien pour le système.
   */
  package: string;
  playing: boolean;
  /** Pochette réduite en `data:` URL, quand le lecteur en publie une. */
  artwork: string | null;
}

export interface NowPlayingState {
  track: NowPlayingTrack | null;
  /** L'accès est-il accordé ? `null` tant que le greffon n'a rien dit (ou hors APK). */
  permission: boolean | null;
}

export type MusicAction = "playPause" | "next" | "previous";

interface NowPlayingPlugin {
  getStatus: () => unknown;
  openSettings: () => unknown;
  start: () => unknown;
  stop: () => unknown;
  control: (options: { action: MusicAction }) => unknown;
  openPlayer: () => unknown;
  addListener: (event: "change", listener: (data: unknown) => void) => unknown;
}

interface CapacitorGlobal {
  Plugins?: Record<string, unknown>;
  isPluginAvailable?: (name: string) => boolean;
}

function plugin(): NowPlayingPlugin | null {
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isPluginAvailable?.("NowPlaying")) return null;
  return (capacitor.Plugins?.NowPlaying as NowPlayingPlugin | undefined) ?? null;
}

/** Vrai dans l'application Android, où la fonction existe. */
export function hasNowPlaying(): boolean {
  return plugin() !== null;
}

/** L'accès aux lecteurs a-t-il été accordé dans les réglages du téléphone ? */
export function getMusicAccess(): Promise<boolean> {
  const nowPlaying = plugin();
  if (!nowPlaying) return Promise.resolve(false);
  try {
    return Promise.resolve(nowPlaying.getStatus()).then(
      (status) => (status as { permission?: unknown } | null)?.permission === true,
      () => false
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** Ouvre la page des réglages Android où l'on autorise MY OSM. */
export function openMusicAccessSettings(): void {
  try {
    void Promise.resolve(plugin()?.openSettings()).catch(() => {});
  } catch {
    /* rien à ouvrir */
  }
}

// --- Le magasin -------------------------------------------------------------

const EMPTY: NowPlayingState = { track: null, permission: null };
let state: NowPlayingState = EMPTY;
const listeners = new Set<() => void>();
let stopListening: (() => void) | null = null;

function sameTrack(a: NowPlayingTrack | null, b: NowPlayingTrack | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.app === b.app &&
    // Le paquet, et pas seulement son libellé : deux lecteurs peuvent porter le
    // même nom affichable, et c'est le paquet qui décide de ce qu'ouvre la
    // pochette.
    a.package === b.package &&
    a.playing === b.playing &&
    a.artwork === b.artwork
  );
}

function setState(next: NowPlayingState) {
  if (next.permission === state.permission && sameTrack(next.track, state.track)) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/** Lecture tolérante de ce qu'envoie le greffon : un champ manquant ne casse rien. */
function parseTrack(data: unknown): NowPlayingTrack | null {
  const raw = (data as { track?: unknown } | null)?.track;
  if (!raw || typeof raw !== "object") return null;
  const fields = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const title = text(fields.title);
  const artist = text(fields.artist);
  // Un lecteur qui charge encore n'a ni titre ni artiste : rien à montrer.
  if (!title && !artist) return null;
  const artwork = typeof fields.artwork === "string" && fields.artwork.startsWith("data:image/") ? fields.artwork : null;
  return {
    title,
    artist,
    album: text(fields.album),
    app: text(fields.app),
    // Absent des versions du greffon antérieures à l'ouverture du lecteur : la
    // chaîne vide vaut « on ne sait pas quoi ouvrir », et la pochette reste
    // alors sans effet.
    package: text(fields.package),
    playing: fields.playing === true,
    artwork,
  };
}

function parsePermission(data: unknown): boolean | null {
  const permission = (data as { permission?: unknown } | null)?.permission;
  return typeof permission === "boolean" ? permission : state.permission;
}

function removeHandle(handle: unknown) {
  try {
    const remove = (handle as { remove?: unknown } | null)?.remove;
    if (typeof remove === "function") void Promise.resolve(remove.call(handle)).catch(() => {});
  } catch {
    /* rien à retirer */
  }
}

function startListening() {
  const nowPlaying = plugin();
  if (!nowPlaying || stopListening) return;
  let stopped = false;
  let handle: unknown = null;

  // L'écouteur d'abord, l'écoute native ensuite : le premier état part dès
  // `start`, et serait perdu sinon.
  try {
    Promise.resolve(
      nowPlaying.addListener("change", (data) => {
        if (!stopped) setState({ track: parseTrack(data), permission: parsePermission(data) });
      })
    )
      .then((listener) => {
        if (stopped) {
          removeHandle(listener);
          return;
        }
        handle = listener;
        return Promise.resolve(nowPlaying.start());
      })
      .catch(() => {});
  } catch {
    /* greffon inutilisable : pas d'encart */
  }

  stopListening = () => {
    stopped = true;
    if (handle) removeHandle(handle);
    try {
      void Promise.resolve(nowPlaying.stop()).catch(() => {});
    } catch {
      /* rien à arrêter */
    }
    stopListening = null;
    // L'accès peut changer d'ici la prochaine navigation : on l'oublie, le
    // greffon le redira au prochain départ.
    setState(EMPTY);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startListening();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopListening?.();
  };
}

/** Le morceau en cours et l'état de l'accès. Écoute tant que le composant est monté. */
export function useNowPlaying(): NowPlayingState {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/** Pause / lecture, titre suivant, titre précédent — sur le lecteur montré. */
export function controlMusic(action: MusicAction): void {
  const nowPlaying = plugin();
  if (!nowPlaying) return;
  // Réponse immédiate à l'écran ; l'état réel du lecteur suit dans l'instant.
  if (action === "playPause" && state.track) {
    setState({ ...state, track: { ...state.track, playing: !state.track.playing } });
  }
  try {
    void Promise.resolve(nowPlaying.control({ action })).catch(() => {});
  } catch {
    /* lecteur disparu entre-temps */
  }
}

/**
 * Ouvre l'application qui joue le morceau montré.
 *
 * Le greffon passe par l'intention de lancement qu'Android associe au paquet :
 * c'est la seule façon d'ouvrir une application tierce sans rien connaître
 * d'elle. Sans effet si le lecteur n'a pas d'écran à ouvrir — certains services
 * de fond n'en ont pas — ou hors de l'APK. **Un doigt sans effet vaut mieux
 * qu'une erreur à l'écran** : la pochette reste alors ce qu'elle était.
 */
export function openMusicPlayer(): void {
  const nowPlaying = plugin();
  if (!nowPlaying) return;
  try {
    void Promise.resolve(nowPlaying.openPlayer()).catch(() => {});
  } catch {
    /* lecteur disparu entre-temps */
  }
}
