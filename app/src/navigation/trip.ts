import { formatDuration } from "../utils/format";
import type { Trip } from "./history";
import { navText } from "./strings";

// ---------------------------------------------------------------------------
// Ce qu'on dit d'un trajet terminé : les chiffres qui s'en déduisent, et le
// bloc de texte qu'on partage.
//
// Tout est calculé au rendu, à partir des seules valeurs gardées (distance,
// temps, pas). Un trajet enregistré ne porte donc aucune phrase, ni aucune
// vitesse pré-calculée : changer de langue ou d'arrondi refait l'affichage d'un
// historique vieux de six mois, ce qu'une chaîne figée interdirait.
// ---------------------------------------------------------------------------

/** Vitesse moyenne en km/h, ou `null` si le trajet n'a ni durée ni longueur. */
export function averageSpeed(trip: Trip): number | null {
  if (trip.distanceMeters < 1 || trip.elapsedSeconds < 1) return null;
  return trip.distanceMeters / 1000 / (trip.elapsedSeconds / 3600);
}

/**
 * L'allure, en secondes par kilomètre. C'est l'inverse de la vitesse, et c'est
 * pourtant l'autre qu'on lit en marchant : « douze minutes au kilomètre » se
 * rapporte à la distance qui reste bien mieux que « cinq à l'heure ».
 */
export function pace(trip: Trip): number | null {
  if (trip.distanceMeters < 1 || trip.elapsedSeconds < 1) return null;
  return trip.elapsedSeconds / (trip.distanceMeters / 1000);
}

/** L'allure écrite à la façon des coureurs : `12’30”`. */
export function formatPace(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  // 59,7 s s'arrondit à 60 : sans ce report, l'allure s'écrirait « 12’60” ».
  if (seconds === 60) return `${minutes + 1}’00”`;
  return `${minutes}’${String(seconds).padStart(2, "0")}”`;
}

export function formatSpeed(kmh: number, locale: string): string {
  return `${kmh.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km/h`;
}

/**
 * L'écart entre le temps mis et le temps annoncé pour la **même portion**
 * (voir `useNavigation`). En deçà d'une minute, on est à l'heure : annoncer
 * « 12 secondes d'avance » sur une estimation de moteur d'itinéraire donnerait
 * à ce chiffre une précision qu'il n'a pas.
 */
export function timeDelta(trip: Trip): { kind: "ahead" | "late" | "onTime"; seconds: number } {
  const delta = trip.elapsedSeconds - trip.announcedSeconds;
  if (Math.abs(delta) < 60 || trip.announcedSeconds < 30) return { kind: "onTime", seconds: 0 };
  return { kind: delta < 0 ? "ahead" : "late", seconds: Math.abs(delta) };
}

/** La phrase qui compare les deux temps. */
export function deltaText(trip: Trip): string {
  const delta = timeDelta(trip);
  if (delta.kind === "onTime") return navText("trip.onTime");
  return navText(delta.kind === "ahead" ? "trip.ahead" : "trip.late", {
    time: formatDuration(delta.seconds),
  });
}

/** D'où vient le nombre de pas, en un mot. */
export function stepsOrigin(trip: Trip): string {
  if (trip.stepSource === "device") return navText("trip.stepsDevice");
  return navText(trip.stepSource === "sensor" ? "trip.stepsCounted" : "trip.stepsEstimated");
}

/**
 * Le titre d'un trajet dans la liste : sa date courte, puis l'heure du départ
 * (demande explicite). La date suit la langue de l'interface et non la
 * `locale` : « 14/09/26 » en français, « 09/14/26 » en anglais — la locale
 * anglaise est `en-GB` pour les heures de 0 à 24, et écrirait le jour d'abord.
 */
export function tripListTitle(trip: Trip, locale: string): string {
  const at = new Date(trip.startedAt);
  const two = (n: number) => String(n).padStart(2, "0");
  const day = two(at.getDate());
  const month = two(at.getMonth() + 1);
  const year = two(at.getFullYear() % 100);
  const date = locale.startsWith("en") ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

/**
 * Le parcours en une ligne. Une extrémité peut n'avoir aucun nom — le géocodage
 * inverse ne répond pas partout — et « → Gare de Lyon » vaut mieux qu'une
 * flèche qui ne relie rien.
 */
export function routeLabel(trip: Trip): string {
  if (trip.kind === "run") return trip.from ? navText("run.from", { from: trip.from }) : "";
  if (trip.from && trip.to) return navText("trip.route", { from: trip.from, to: trip.to });
  return trip.to || trip.from || "";
}

/**
 * La date d'un trajet, avec son année : c'est l'en-tête du partage, où le
 * message se lira peut-être des mois plus tard et loin de l'application. Le
 * titre de la liste, lui, se passe de l'année — on y est déjà situé.
 */
export function tripDate(trip: Trip, locale: string): string {
  return new Date(trip.endedAt).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** L'heure de départ et d'arrivée, pour la seconde ligne de la liste. */
export function tripTimes(trip: Trip, locale: string): string {
  const format = (at: number) =>
    new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${format(trip.startedAt)} → ${format(trip.endedAt)}`;
}
