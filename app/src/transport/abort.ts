// ---------------------------------------------------------------------------
// Annulation : ce qui ne sert plus doit s'arrêter, et le dire proprement.
//
// Une annulation (carte déplacée, fiche fermée, région quittée) n'est pas un
// échec : elle ne compte pas pour le disjoncteur et ne déclenche aucun repli.
// Un délai dépassé, lui, en est un (`TimeoutError`).
// ---------------------------------------------------------------------------

import { anySignal as combine } from "../utils/signals";

export function abortError(): DOMException {
  return new DOMException("Annulé", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

/**
 * Un signal qui s'arrête dès que l'un des signaux donnés s'arrête.
 *
 * L'implantation vit dans `utils/signals.ts`, avec son repli : `AbortSignal.any`
 * demande une WebView 116, et l'application s'installe à partir d'Android 7.
 */
export const anySignal = combine;

/**
 * Attend une promesse, mais rend la main dès que le signal s'arrête. La promesse
 * elle-même continue — un appel natif ne sait pas s'interrompre — son résultat
 * est simplement ignoré.
 */
export function raceSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** Attente interrompue par le signal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return raceSignal(new Promise<void>((resolve) => setTimeout(resolve, ms)), signal);
}
