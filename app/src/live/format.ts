import { currentLocale } from "../i18n";
import type { FuelPrice } from "./fuel";

// ---------------------------------------------------------------------------
// Les nombres des modes en direct, tels qu'on les lit : un prix court sur la
// carte (« 1,99 »), long dans la fiche (« 1,990 € »), et l'âge d'un prix.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Au-delà, un prix est signalé comme ancien (point orange, mention dans la fiche). */
export const STALE_DAYS = 7;

export function isStale(at: number, now = Date.now()): boolean {
  return now - at > STALE_DAYS * DAY_MS;
}

/** Sur l'étiquette : deux décimales, et la monnaie seulement quand ce n'est pas l'euro. */
export function shortPrice(p: FuelPrice): string {
  const options: Intl.NumberFormatOptions =
    p.currency === "EUR"
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { style: "currency", currency: p.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat(currentLocale(), options).format(p.price);
}

/** Dans la fiche : trois décimales, comme à la pompe. */
export function fullPrice(p: FuelPrice): string {
  return new Intl.NumberFormat(currentLocale(), {
    style: "currency",
    currency: p.currency,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(p.price);
}

/** L'âge d'une donnée, en unités entières : `{ unit, value }` pour la phrase traduite. */
export function ageOf(at: number, now = Date.now()): { unit: "now" | "minutes" | "hours" | "days"; value: number } {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return { unit: "now", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };
  return { unit: "days", value: Math.round(hours / 24) };
}
