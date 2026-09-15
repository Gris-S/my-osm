import type { RunSample } from "../history";

// ---------------------------------------------------------------------------
// Le mode course : ses réglages de capture, et les calculs de l'allure.
//
// La capture suit le modèle des traceurs GPS comme Colota : **un intervalle de
// temps, un filtre de précision et un seuil de déplacement**, plutôt que chaque
// relevé brut. Le GPS d'un téléphone rend environ un relevé par seconde ; en
// garder un toutes les deux secondes suffit à suivre un virage de course, et
// divise par deux ce qu'il faut stocker et dessiner.
// ---------------------------------------------------------------------------

/** L'orange du mode course : tracé, textes et graphe (orange iOS, clair et sombre). */
export const RUN_COLOR = "#FF9500";
export const RUN_COLOR_DARK = "#FF9F0A";

/** Un relevé gardé toutes les deux secondes au plus. */
export const SAMPLE_INTERVAL_MS = 2000;
/**
 * Un relevé dont l'incertitude dépasse trente mètres est écarté : sous les
 * arbres ou entre deux immeubles, il ferait zigzaguer le tracé et gonflerait la
 * distance d'autant.
 */
export const MAX_ACCURACY_M = 30;
/**
 * Le plus petit déplacement compté depuis le dernier point retenu : **la moitié
 * de l'incertitude annoncée, et jamais moins de deux mètres** (`minStepFor`).
 *
 * Un seuil fixe ne suffit pas : mesuré sur Pixel 8, immobile en intérieur
 * (incertitude d'une dizaine de mètres), une course de 53 s comptait 44 m avec
 * un seuil de 2 m — le point GPS erre de plusieurs mètres d'un relevé à
 * l'autre. Rapporté à l'incertitude, le seuil reste bas dehors, où le GPS est
 * précis, et monte là où il divague. Les petits pas ne se perdent pas pour
 * autant : le seuil se mesure depuis le dernier point **compté**, et un coureur
 * lent le franchit en deux ou trois relevés.
 */
export const MIN_STEP_M = 2;

export function minStepFor(accuracyMeters: number): number {
  return Math.max(MIN_STEP_M, accuracyMeters / 2);
}
/** Une course arrêtée moins de 45 s après son lancement ne laisse aucune trace. */
export const MIN_RUN_MS = 45_000;
/** Zoom de la carte qui suit le coureur. */
export const RUN_ZOOM = 16.5;

export interface PacePoint {
  /** Milieu de la tranche, en mètres depuis le départ. */
  atMeters: number;
  /** Allure sur la tranche, en secondes par kilomètre. */
  secondsPerKm: number;
}

/**
 * L'allure tout au long de la course, par tranches de distance.
 *
 * Par tranches de distance et non de temps : c'est ainsi qu'on lit une course
 * (« au troisième kilomètre j'ai ralenti »). Une soixantaine de tranches au
 * plus, cinquante mètres au moins — plus fin, l'imprécision du GPS dessinerait
 * des dents de scie qui ne sont pas dans les jambes. Une tranche ne chevauche
 * jamais une pause, et la série est lissée sur trois tranches.
 */
export function paceSeries(samples: RunSample[], totalMeters: number): PacePoint[] {
  if (samples.length < 3 || totalMeters < 150) return [];
  const bucket = Math.max(50, Math.round(totalMeters / 60 / 10) * 10);
  const raw: PacePoint[] = [];
  let from = samples[0];
  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    if (sample.s !== from.s) {
      from = sample;
      continue;
    }
    const meters = sample.d - from.d;
    if (meters >= bucket) {
      const seconds = sample.t - from.t;
      if (seconds > 0) raw.push({ atMeters: (from.d + sample.d) / 2, secondsPerKm: seconds / (meters / 1000) });
      from = sample;
    }
  }
  return raw.map((point, index) => {
    const window = raw.slice(Math.max(0, index - 1), index + 2);
    return {
      atMeters: point.atMeters,
      secondsPerKm: window.reduce((sum, p) => sum + p.secondsPerKm, 0) / window.length,
    };
  });
}

export type RegularityLevel = "high" | "good" | "fair" | "low";

/**
 * La régularité : l'écart-type de l'allure, rapporté à sa moyenne.
 *
 * Moins de 4 % d'écart, c'est une course tenue au métronome ; au-delà de 15 %,
 * on alterne franchement accélérations et ralentissements. L'écart est aussi
 * rendu en secondes par kilomètre, qui se lit mieux qu'un pourcentage.
 */
export function regularity(series: PacePoint[]): { level: RegularityLevel; spreadSeconds: number } | null {
  if (series.length < 4) return null;
  const values = series.map((point) => point.secondsPerKm);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  const ratio = deviation / mean;
  const level: RegularityLevel = ratio < 0.04 ? "high" : ratio < 0.08 ? "good" : ratio < 0.15 ? "fair" : "low";
  return { level, spreadSeconds: Math.round(deviation) };
}

/**
 * L'allure du moment, sur les vingt dernières secondes : assez court pour
 * réagir à une accélération, assez long pour ne pas sauter à chaque relevé.
 * `null` tant qu'on n'a pas couvert quinze mètres sur la fenêtre (à l'arrêt).
 */
export function currentPace(samples: RunSample[], windowSeconds = 20): number | null {
  const last = samples[samples.length - 1];
  if (!last) return null;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    const sample = samples[i];
    if (sample.s !== last.s || last.t - sample.t > windowSeconds) break;
    first = sample;
  }
  const meters = last.d - first.d;
  const seconds = last.t - first.t;
  if (meters < 15 || seconds <= 0) return null;
  return seconds / (meters / 1000);
}

/** Le chronomètre : `12:34`, puis `1:02:03` au-delà de l'heure. */
export function formatRunClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** La distance d'une course, au centième de kilomètre : `3,42 km`. */
export function formatRunDistance(meters: number, locale: string): string {
  return `${(meters / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}
