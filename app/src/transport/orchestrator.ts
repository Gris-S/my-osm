import { abortError, anySignal, isAbortError } from "./abort";
import { CircuitBreakers } from "./circuitBreaker";
import { createSwr, TtlCache, type SwrRequest, type SwrResult } from "./cache";
import type { HttpClient } from "./httpClient";
import type { ProviderId, RegionId } from "./model";
import { CAPABILITY_POLICY, MEMORY_CACHE_MAX_ENTRIES } from "./policy";
import { isRetryable, ProviderError, type Capability, type TransportProvider } from "./provider";
import { providersFor, resolveRegion, type Region } from "./registry";
import { withRetry } from "./retry";

// ---------------------------------------------------------------------------
// L'orchestrateur (§3.3 du document d'architecture).
//
// Lui seul connaît les rangs, les disjoncteurs et les replis ; les adaptateurs
// ne se connaissent pas entre eux. Pour une capacité, il essaie les
// fournisseurs de la région active du rang le plus élevé au plus bas, saute
// ceux dont la clé manque ou dont le disjoncteur est ouvert, applique délai et
// reprises, et rend la première réponse — avec le compte rendu des tentatives,
// pour que l'interface dise honnêtement d'où vient ce qu'elle montre.
//
// **Changer de région décharge l'ancienne** : ses requêtes sont annulées, ses
// fournisseurs libérés (minuteurs compris), son cache mémoire oublié. Aucun
// fournisseur n'est chargé tant que sa région n'est pas active (import
// dynamique à la première capacité demandée).
// ---------------------------------------------------------------------------

export interface ProviderContext {
  region: Region;
  http: HttpClient;
  /** Cache de la région, clés préfixées d'office par l'identifiant de la région. */
  cached<V>(request: SwrRequest<V>): Promise<SwrResult<V>>;
}

export type ProviderFactory = (context: ProviderContext) => TransportProvider;
export type ProviderLoader = () => Promise<ProviderFactory>;

export interface AttemptReport {
  providerId: ProviderId;
  outcome: "success" | "skipped-key" | "skipped-breaker" | "unsupported" | "failed";
  error?: string;
}

export interface RunResult<T> {
  value: T;
  providerId: ProviderId;
  attempts: AttemptReport[];
}

/** Aucun fournisseur de la région n'a pu répondre. */
export class NoProviderError extends Error {
  readonly capability: Capability;
  readonly attempts: AttemptReport[];

  constructor(capability: Capability, attempts: AttemptReport[]) {
    super(`Aucune source disponible pour « ${capability} »`);
    this.name = "NoProviderError";
    this.capability = capability;
    this.attempts = attempts;
  }
}

export interface OrchestratorOptions {
  loaders: Record<ProviderId, ProviderLoader>;
  http: HttpClient;
  hasKey: (keyId: string) => boolean;
  breakers?: CircuitBreakers;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  regions?: Region[];
}

/** Choisit, dans un fournisseur, la méthode qui répond à la capacité ; `undefined` si absente. */
export type Invoke<T> = (provider: TransportProvider, signal: AbortSignal) => Promise<T> | undefined;

export class TransportOrchestrator {
  private readonly options: OrchestratorOptions;
  private readonly breakers: CircuitBreakers;
  private readonly cache = new TtlCache<unknown>({ maxEntries: MEMORY_CACHE_MAX_ENTRIES });
  private readonly swr = createSwr(this.cache);
  private region: Region | null = null;
  private regionController = new AbortController();
  private readonly instances = new Map<ProviderId, Promise<TransportProvider>>();
  private readonly listeners = new Set<(region: Region) => void>();

  constructor(options: OrchestratorOptions) {
    this.options = options;
    this.breakers = options.breakers ?? new CircuitBreakers();
  }

  get activeRegion(): Region | null {
    return this.region;
  }

  /** Suit la carte : résout la région du point et bascule si elle change. */
  updatePosition(lon: number, lat: number): Region {
    const next = resolveRegion(lon, lat, this.region?.id ?? null, this.options.regions);
    this.setRegion(next);
    return next;
  }

  setRegion(next: Region): void {
    if (this.region?.id === next.id) return;
    const previous = this.region;
    this.region = next;
    if (previous) this.unload(previous.id);
    this.listeners.forEach((listener) => listener(next));
  }

  subscribe(listener: (region: Region) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private unload(regionId: RegionId): void {
    this.regionController.abort(abortError());
    this.regionController = new AbortController();
    for (const [id, instance] of this.instances) {
      void instance.then((provider) => provider.dispose?.(), () => {});
      this.instances.delete(id);
    }
    this.cache.deletePrefix(`${regionId}:`);
  }

  private provider(id: ProviderId, region: Region): Promise<TransportProvider> {
    let instance = this.instances.get(id);
    if (!instance) {
      const loader = this.options.loaders[id];
      if (!loader) return Promise.reject(new Error(`Fournisseur inconnu : ${id}`));
      const context: ProviderContext = {
        region,
        http: this.options.http,
        cached: <V>(request: SwrRequest<V>) =>
          this.swr({ ...request, key: `${region.id}:${id}:${request.key}` } as SwrRequest<unknown>) as Promise<SwrResult<V>>,
      };
      instance = loader().then((factory) => factory(context));
      this.instances.set(id, instance);
      // Un chargement raté ne doit pas rester en mémoire : il sera retenté.
      instance.catch(() => this.instances.delete(id));
    }
    return instance;
  }

  /**
   * Répond à une capacité avec le meilleur fournisseur disponible de la région
   * active. `invoke` choisit la méthode : `(p, s) => p.getDepartures?.(id, {}, s)`.
   */
  async run<T>(capability: Capability, invoke: Invoke<T>, signal?: AbortSignal): Promise<RunResult<T>> {
    const region = this.region;
    if (!region) throw new NoProviderError(capability, []);
    const policy = CAPABILITY_POLICY[capability];
    const regionSignal = this.regionController.signal;
    const attempts: AttemptReport[] = [];

    for (const candidate of providersFor(region, capability)) {
      if (signal?.aborted || regionSignal.aborted) throw abortError();
      if (candidate.needsKey && !this.options.hasKey(candidate.needsKey)) {
        attempts.push({ providerId: candidate.id, outcome: "skipped-key" });
        continue;
      }
      // Déclaré au registre mais pas encore écrit (ou retiré) : ce n'est pas un
      // échec de la source, le disjoncteur n'a rien à en savoir.
      if (!this.options.loaders[candidate.id]) {
        attempts.push({ providerId: candidate.id, outcome: "unsupported" });
        continue;
      }
      const breakerKey = `${candidate.id}:${capability}`;
      if (!this.breakers.allow(breakerKey)) {
        attempts.push({ providerId: candidate.id, outcome: "skipped-breaker" });
        continue;
      }

      try {
        const provider = await this.provider(candidate.id, region);
        let supported = true;
        const value = await withRetry(
          async () => {
            const attemptSignal = anySignal([signal, regionSignal, AbortSignal.timeout(policy.timeoutMs)]);
            const pending = invoke(provider, attemptSignal);
            if (!pending) {
              supported = false;
              return undefined as T;
            }
            return pending;
          },
          policy.retryDelaysMs,
          { signal: anySignal([signal, regionSignal]), shouldRetry: isRetryable, sleep: this.options.sleep }
        );
        if (!supported) {
          attempts.push({ providerId: candidate.id, outcome: "unsupported" });
          continue;
        }
        this.breakers.success(breakerKey);
        attempts.push({ providerId: candidate.id, outcome: "success" });
        return { value, providerId: candidate.id, attempts };
      } catch (error) {
        if (isAbortError(error) || signal?.aborted || regionSignal.aborted) throw isAbortError(error) ? error : abortError();
        if (error instanceof ProviderError && error.kind === "rateLimited") {
          this.breakers.openFor(breakerKey, error.retryAfterMs ?? policy.breaker.openMs);
        } else {
          this.breakers.failure(breakerKey, policy.breaker);
        }
        attempts.push({ providerId: candidate.id, outcome: "failed", error: String((error as Error)?.message ?? error) });
      }
    }
    throw new NoProviderError(capability, attempts);
  }
}
