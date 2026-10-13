import { useSyncExternalStore } from "react";
import { currentLang } from "../i18n";
import { inLanguage, navText } from "./strings";
import { SPOKEN_LANGUAGES } from "./voicePhrases";

// ---------------------------------------------------------------------------
// La voix du guidage voiture (demande explicite, 13 octobre 2026).
//
// Jusqu'ici l'application ne faisait qu'un son, les deux notes du radar. Elle
// parle désormais, selon un réglage à trois crans posé sur la barre du bas, à
// l'opposé du bouton d'arrêt :
//
//   - `all`    : les manœuvres, et les alertes ;
//   - `alerts` : les alertes seulement — radar, accident, bouchon devant ;
//   - `off`    : rien. Les deux notes du radar, elles, restent.
//
// **Deux moteurs.** Dans l'APK, le greffon `Speech`
// (`apk/android/.../SpeechPlugin.java`) : une WebView Android n'a pas de
// `speechSynthesis`. Dans un navigateur (version Docker), `speechSynthesis`.
// Dans les deux cas la synthèse est celle de l'appareil ; sans moteur installé
// le bouton se grise.
//
// Ce qui se dit, et quand, est décidé par des fonctions pures, testées
// (`nextAnnouncement`, `spokenDistance`) : le module ne fait que les prononcer.
// ---------------------------------------------------------------------------

export type VoiceMode = "all" | "alerts" | "off";

const STORAGE_KEY = "osm-local:nav-voice";
const ORDER: VoiceMode[] = ["all", "alerts", "off"];

function read(): VoiceMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "all" || stored === "alerts" || stored === "off" ? stored : "all";
  } catch {
    return "all";
  }
}

let mode: VoiceMode = read();
/** `null` tant qu'on ne sait pas : le moteur natif répond après coup. */
let available: boolean | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function voiceMode(): VoiceMode {
  return mode;
}

export function useVoiceMode(): VoiceMode {
  return useSyncExternalStore(subscribe, voiceMode, voiceMode);
}

/** Le cran suivant, et il se dit lui-même : c'est la seule confirmation qu'on entend sans regarder. */
export function cycleVoiceMode(): void {
  mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* le choix restera simplement non persisté */
  }
  notify();
  say(inSpokenLanguage(() => navText(`voice.mode.${mode}`)), true);
}

// --- Les moteurs -------------------------------------------------------------

interface SpeechPlugin {
  isAvailable: () => unknown;
  speak: (options: { text: string; lang: string; flush: boolean; voice?: string }) => unknown;
  voices: () => unknown;
  installVoices: () => unknown;
  stop: () => unknown;
}

function plugin(): SpeechPlugin | null {
  const capacitor = (
    window as unknown as { Capacitor?: { isPluginAvailable?: (name: string) => boolean; Plugins?: Record<string, unknown> } }
  ).Capacitor;
  if (!capacitor?.isPluginAvailable?.("Speech")) return null;
  return (capacitor.Plugins?.Speech as SpeechPlugin | undefined) ?? null;
}

const webSpeech = () => (typeof speechSynthesis === "undefined" ? null : speechSynthesis);

/** Cherche le moteur, une fois. Le bouton se redessine quand la réponse arrive. */
function probe(): void {
  if (available !== null) return;
  const native = plugin();
  if (!native) {
    available = webSpeech() !== null;
    return;
  }
  available = false;
  void Promise.resolve(native.isAvailable())
    .then((answer) => {
      available = (answer as { available?: boolean } | null)?.available === true;
      notify();
    })
    .catch(() => {});
}

/** Vrai si l'appareil a de quoi parler. S'abonne : la réponse du natif arrive après le premier rendu. */
export function useVoiceAvailable(): boolean {
  probe();
  return useSyncExternalStore(
    subscribe,
    () => available === true,
    () => false,
  );
}


const LOCALES = { fr: "fr-FR", en: "en-GB" } as const;

// --- Le choix de la voix (Paramètres › Navigation) ---------------------------
//
// Demande du 13 octobre 2026 : on choisit une **langue parmi celles déjà
// téléchargées**, puis une de ses voix. Android ne dit pas si une voix est
// masculine ou féminine — elle n'a qu'un nom de code : on les numérote, et
// l'on donne à entendre. Les annonces, elles, ne sont écrites qu'en français
// et en anglais : une voix d'une autre langue les lit avec son accent, et les
// réglages le disent. **La voix choisie décide de la langue des annonces**
// (`spokenLanguage`), quelle que soit celle de l'interface. Télécharger
// une voix est l'affaire du moteur ; on ne peut qu'ouvrir son écran
// (`openVoiceDownloads`).

const VOICE_KEY = "osm-local:nav-voice-name";

/** Une voix de l'appareil, dans la langue de l'interface. */
export interface DeviceVoice {
  /** Le nom que le moteur lui donne : c'est lui qu'on retient. */
  name: string;
  /** `fr-FR`, `fr-CA`, `en-GB`… */
  locale: string;
  installed: boolean;
}

/** La voix retenue : son nom pour le moteur, et sa langue (`fr-FR`), qui décide de ce qui se dit. */
interface ChosenVoice {
  name: string;
  locale: string;
}

function readChosen(): ChosenVoice | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOICE_KEY) ?? "null") as Partial<ChosenVoice> | null;
    return parsed && typeof parsed.name === "string" && typeof parsed.locale === "string"
      ? { name: parsed.name, locale: parsed.locale }
      : null;
  } catch {
    return null;
  }
}

let chosen = readChosen();

/** Le nom de la voix retenue, ou `""` pour celle du téléphone. */
export function chosenVoice(): string {
  return chosen?.name ?? "";
}

export function useChosenVoice(): string {
  return useSyncExternalStore(subscribe, chosenVoice, chosenVoice);
}

/** Retient une voix ; sans nom, revient à celle du téléphone. */
export function chooseVoice(name: string, locale = ""): void {
  chosen = name ? { name, locale } : null;
  try {
    if (chosen) localStorage.setItem(VOICE_KEY, JSON.stringify(chosen));
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    /* le choix restera simplement non persisté */
  }
  notify();
}

/** La langue qu'une voix sait dire parmi celles qu'on sait écrire, ou `null`. */
export function spokenLanguageOf(locale: string): string | null {
  const lang = locale.slice(0, 2).toLowerCase();
  return SPOKEN_LANGUAGES.includes(lang) ? lang : null;
}

/**
 * **La voix parle sa langue**, pas celle de l'interface (demande explicite,
 * 13 octobre 2026) : une voix française dit « tournez à gauche » même si
 * l'application est en anglais, une voix italienne « gira a sinistra ». Sans
 * voix choisie, ou pour une langue qu'on ne sait pas écrire, c'est la langue
 * de l'interface.
 */
export function spokenLanguage(): string {
  return (chosen && spokenLanguageOf(chosen.locale)) ?? currentLang();
}

/** Compose une annonce dans la langue de la voix : à poser autour de tout ce qui sera dit. */
export function inSpokenLanguage<T>(compose: () => T): T {
  return inLanguage(spokenLanguage(), compose);
}

/**
 * Les voix **déjà sur l'appareil**, toutes langues confondues, celles qui
 * marchent sans réseau. Fonction pure sur la liste brute : testée.
 */
export function installedVoices(all: { name: string; locale: string; network?: boolean; installed?: boolean }[]): DeviceVoice[] {
  return all
    .filter((voice) => !voice.network && voice.installed !== false)
    // « fr-FR-language » est la voix par défaut de la région, pas une voix de plus.
    .filter((voice) => !/-language$/i.test(voice.name))
    .map((voice) => ({ name: voice.name, locale: voice.locale, installed: true }))
    .sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
}

/** Les voix installées ; liste vide si le moteur n'en donne pas. */
export async function listVoices(): Promise<DeviceVoice[]> {
  const native = plugin();
  if (native) {
    await Promise.resolve(native.isAvailable()).catch(() => {});
    const answer = (await Promise.resolve(native.voices()).catch(() => null)) as { voices?: Parameters<typeof installedVoices>[0] } | null;
    return installedVoices(answer?.voices ?? []);
  }
  const web = webSpeech();
  if (!web) return [];
  return installedVoices(
    web.getVoices().map((voice) => ({ name: voice.name, locale: voice.lang.replace("_", "-"), network: false, installed: true })),
  );
}

/** Vrai si l'on peut envoyer vers un écran de téléchargement de voix (APK). */
export function canDownloadVoices(): boolean {
  return plugin() !== null;
}

/** Ouvre l'écran du moteur où l'on télécharge des voix. */
export function openVoiceDownloads(): void {
  try {
    void Promise.resolve(plugin()?.installVoices()).catch(() => {});
  } catch {
    /* pas de moteur : rien à ouvrir */
  }
}

/** Fait entendre une voix, sans la retenir — dans **sa** langue quand on sait l'écrire. */
export function sampleVoice(name: string, locale = ""): void {
  const lang = name ? spokenLanguageOf(locale) : null;
  say(inLanguage(lang ?? currentLang(), () => navText("settings.voice.sample")), true, name);
}

/** Prononce, quel que soit le réglage : à l'appelant de le consulter (`speak`). */
function say(text: string, flush = false, voice = chosenVoice()): void {
  probe();
  const lang = LOCALES[currentLang()] ?? "fr-FR";
  try {
    const native = plugin();
    if (native) {
      void Promise.resolve(native.speak({ text, lang, flush, voice })).catch(() => {});
      return;
    }
    const web = webSpeech();
    if (!web) return;
    if (flush) web.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const picked = voice ? web.getVoices().find((candidate) => candidate.name === voice) : undefined;
    if (picked) utterance.voice = picked;
    web.speak(utterance);
  } catch {
    /* une annonce manquée ne doit jamais arrêter le guidage */
  }
}

/**
 * Dit une annonce si le réglage le veut : une `alert` passe en `all` et en
 * `alerts`, une manœuvre (`guidance`) en `all` seulement.
 */
export function speak(text: string, kind: "guidance" | "alert"): void {
  if (mode === "off" || (mode === "alerts" && kind !== "alert")) return;
  say(text);
}

/** Fait taire la voix : fin du guidage. */
export function stopSpeaking(): void {
  try {
    const native = plugin();
    if (native) void Promise.resolve(native.stop()).catch(() => {});
    else webSpeech()?.cancel();
  } catch {
    /* rien à arrêter */
  }
}

// --- Ce qui se dit -----------------------------------------------------------

/** Une distance telle qu'on la dit : « 300 mètres », « 1 kilomètre », « 2,5 kilomètres ». */
export function spokenDistance(meters: number): string {
  if (meters < 950) {
    const step = meters >= 300 ? 50 : 10;
    return navText("voice.meters", { n: Math.max(step, Math.round(meters / step) * step) });
  }
  const km = meters < 4750 ? Math.round(meters / 500) / 2 : Math.round(meters / 1000);
  if (km === 1) return navText("voice.km1");
  // La virgule partout, sauf en anglais — et dans la langue où l'on compose.
  return navText("voice.km", { n: String(km).replace(".", navText("voice.km1").includes("kilometre") ? "." : ",") });
}

/** Ce que la voix retient d'un relevé à l'autre : la manœuvre, et combien d'annonces elle a eues. */
export interface VoiceMemory {
  step: number;
  said: number;
}

export const NO_VOICE_MEMORY: VoiceMemory = { step: -1, said: 0 };

/**
 * Faut-il annoncer la manœuvre maintenant ?
 *
 * Deux annonces par manœuvre, comptées **en temps** et non en mètres — trois
 * cents mètres sont dix secondes sur autoroute et une minute en ville :
 *
 *   1. « dans 400 mètres, tournez à gauche » — une demi-minute avant, 300 m au moins ;
 *   2. « tournez à gauche » — huit secondes avant, 40 m au moins.
 *
 * Une manœuvre qui commence déjà sous le premier seuil (deux virages
 * enchaînés) n'a que la seconde, dite avec sa distance si elle est encore loin.
 * `now` est vrai pour l'annonce sans distance.
 */
export function nextAnnouncement(
  memory: VoiceMemory,
  input: { step: number; distanceMeters: number; speedMps: number | null },
): { memory: VoiceMemory; announce: { now: boolean } | null } {
  const said = memory.step === input.step ? memory.said : 0;
  const speed = input.speedMps ?? 13.9;
  const far = Math.max(300, speed * 30);
  const near = Math.max(40, speed * 8);
  const due = input.distanceMeters <= near ? 2 : input.distanceMeters <= far ? 1 : 0;
  if (due <= said) return { memory: { step: input.step, said }, announce: null };
  // À moins de quinze mètres par seconde d'avance sur le seuil, on est « maintenant ».
  return { memory: { step: input.step, said: due }, announce: { now: due === 2 && input.distanceMeters <= near } };
}

/** La phrase d'une manœuvre : « Dans 400 mètres, tournez à gauche, rue de Rivoli ». */
export function maneuverSentence(action: string, where: string, distanceMeters: number, now: boolean): string {
  const what = where ? `${action}, ${where}` : action;
  if (now) return what;
  return navText("voice.in", { distance: spokenDistance(distanceMeters), action: what.charAt(0).toLowerCase() + what.slice(1) });
}
