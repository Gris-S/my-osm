// ---------------------------------------------------------------------------
// Cache mémoire de la couche transport : durée de vie, éviction LRU, et
// *stale-while-revalidate* (§2f du document d'architecture).
//
// Une donnée périmée mais encore acceptable est rendue **tout de suite**, et
// rafraîchie derrière ; les données qui n'ont pas le droit d'être périmées
// (départs en temps réel, itinéraires) sont oubliées à l'échéance. Deux
// demandes identiques en vol n'en font qu'une.
//
// La persistance (IndexedDB) viendra avec les arrêts par tuile, qui en ont
// besoin ; tout le reste vit très bien en mémoire.
// ---------------------------------------------------------------------------

interface Entry<V> {
  value: V;
  storedAt: number;
  ttlMs: number;
  allowStale: boolean;
}

export interface CacheHit<V> {
  value: V;
  fresh: boolean;
  ageMs: number;
}

export interface TtlCacheOptions {
  maxEntries: number;
  /** Au-delà de sa durée de vie augmentée de cette marge, même une donnée « périmable » est oubliée. */
  maxStaleMs?: number;
  now?: () => number;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly maxStaleMs: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions) {
    this.maxEntries = options.maxEntries;
    this.maxStaleMs = options.maxStaleMs ?? 7 * 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): CacheHit<V> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const ageMs = this.now() - entry.storedAt;
    const fresh = ageMs < entry.ttlMs;
    if (!fresh && (!entry.allowStale || ageMs > entry.ttlMs + this.maxStaleMs)) {
      this.entries.delete(key);
      return undefined;
    }
    // Récemment lue : passe en fin de file, loin de l'éviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { value: entry.value, fresh, ageMs };
  }

  set(key: string, value: V, ttlMs: number, allowStale = true): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: this.now(), ttlMs, allowStale });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Oublie tout ce qui commence par `prefix` — les données d'une région quittée. */
  deletePrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }
}

export interface SwrRequest<V> {
  key: string;
  ttlMs: number;
  allowStale?: boolean;
  load: () => Promise<V>;
  /** Appelé quand une donnée servie périmée a été rafraîchie. */
  onRevalidated?: (value: V) => void;
}

export interface SwrResult<V> {
  value: V;
  /** Faux : la valeur est périmée, un rafraîchissement est en cours. */
  fresh: boolean;
}

/** Lecture avec cache : fraîche, périmée puis rafraîchie, ou chargée. */
export function createSwr<V>(cache: TtlCache<V>) {
  const inFlight = new Map<string, Promise<V>>();

  const load = (request: SwrRequest<V>): Promise<V> => {
    let pending = inFlight.get(request.key);
    if (!pending) {
      pending = request
        .load()
        .then((value) => {
          cache.set(request.key, value, request.ttlMs, request.allowStale ?? true);
          return value;
        })
        .finally(() => inFlight.delete(request.key));
      inFlight.set(request.key, pending);
    }
    return pending;
  };

  return async function swr(request: SwrRequest<V>): Promise<SwrResult<V>> {
    const hit = cache.get(request.key);
    if (hit?.fresh) return { value: hit.value, fresh: true };
    if (hit) {
      load(request).then(
        (value) => request.onRevalidated?.(value),
        () => {
          /* la valeur périmée reste affichée ; la prochaine lecture réessaiera */
        }
      );
      return { value: hit.value, fresh: false };
    }
    return { value: await load(request), fresh: true };
  };
}
