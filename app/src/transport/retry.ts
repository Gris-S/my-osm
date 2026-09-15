import { isAbortError, sleep as defaultSleep } from "./abort";

// ---------------------------------------------------------------------------
// Reprises avec attente croissante (délais fixés par capacité dans `policy.ts`).
// ---------------------------------------------------------------------------

export interface RetryOptions {
  signal?: AbortSignal;
  /** Faux : l'erreur est rendue sans nouvelle tentative. Vrai par défaut. */
  shouldRetry?: (error: unknown) => boolean;
  /** Injectable pour les tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Appelle `attempt` jusqu'à ce qu'il réussisse ou que les délais soient épuisés.
 * Une annulation arrête tout aussitôt, sans reprise.
 */
export async function withRetry<T>(
  attempt: (index: number) => Promise<T>,
  delaysMs: readonly number[],
  options: RetryOptions = {}
): Promise<T> {
  const wait = options.sleep ?? defaultSleep;
  for (let index = 0; ; index++) {
    try {
      return await attempt(index);
    } catch (error) {
      const exhausted = index >= delaysMs.length;
      if (exhausted || isAbortError(error) || options.signal?.aborted) throw error;
      if (options.shouldRetry && !options.shouldRetry(error)) throw error;
      await wait(delaysMs[index], options.signal);
    }
  }
}
