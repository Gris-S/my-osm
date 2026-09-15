import { raceSignal } from "./abort";
import { MAX_CONCURRENT_PER_HOST, RESPONSE_MAX_CHARS, transportUserAgent } from "./policy";
import { ProviderError } from "./provider";

// ---------------------------------------------------------------------------
// Le transport HTTP des adaptateurs (§3.9 du document d'architecture).
//
// **Dans l'APK, les appels passent par le natif** (greffon `CapacitorHttp`) :
// une WebView ne peut pas fixer son `User-Agent`, que Transitous et les
// services d'OSM exigent. Hors APK (tests, serveur de développement), `fetch`.
//
// Le client borne tout ce qui peut déraper : délai, taille de la réponse,
// appels simultanés par hôte ; il partage deux demandes identiques en vol et
// type ses erreurs (`ProviderError`) pour que l'orchestrateur décide d'une
// reprise ou d'un repli. Un proxy, plus tard, se branchera ici et nulle part
// ailleurs.
// ---------------------------------------------------------------------------

export interface HttpRequest {
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface HttpClient {
  getJson<T>(request: HttpRequest): Promise<T>;
}

/** Le strict nécessaire du greffon `CapacitorHttp`. */
export interface NativeHttp {
  request(options: {
    url: string;
    method: "GET";
    headers: Record<string, string>;
    responseType: "text";
    connectTimeout?: number;
    readTimeout?: number;
  }): Promise<{ status: number; data: unknown; headers?: Record<string, string> }>;
}

export interface HttpClientOptions {
  userAgent: string;
  native?: NativeHttp | null;
  fetchImpl?: typeof fetch;
  maxPerHost?: number;
  maxChars?: number;
}

interface RawResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const found = Object.keys(headers).find((key) => key.toLowerCase() === wanted);
  return found ? headers[found] : undefined;
}

function retryAfterMs(headers: Record<string, string>): number | undefined {
  const value = header(headers, "Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const maxPerHost = options.maxPerHost ?? MAX_CONCURRENT_PER_HOST;
  const maxChars = options.maxChars ?? RESPONSE_MAX_CHARS;
  const inFlight = new Map<string, Promise<unknown>>();
  const hosts = new Map<string, { active: number; waiting: (() => void)[] }>();

  const acquire = async (host: string) => {
    let slot = hosts.get(host);
    if (!slot) {
      slot = { active: 0, waiting: [] };
      hosts.set(host, slot);
    }
    if (slot.active >= maxPerHost) await new Promise<void>((resolve) => slot.waiting.push(resolve));
    slot.active += 1;
  };
  const release = (host: string) => {
    const slot = hosts.get(host);
    if (!slot) return;
    slot.active -= 1;
    slot.waiting.shift()?.();
  };

  const send = async (request: HttpRequest): Promise<RawResponse> => {
    const headers = { Accept: "application/json", "User-Agent": options.userAgent, ...request.headers };
    if (options.native) {
      try {
        const response = await options.native.request({
          url: request.url,
          method: "GET",
          headers,
          responseType: "text",
          connectTimeout: request.timeoutMs,
          readTimeout: request.timeoutMs,
        });
        const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? null);
        return { status: response.status, text, headers: response.headers ?? {} };
      } catch (error) {
        throw new ProviderError("network", `Réseau injoignable : ${String((error as Error)?.message ?? error)}`);
      }
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
      // Le navigateur refuse qu'on fixe `User-Agent` : il est retiré hors du natif.
      const { "User-Agent": _userAgent, ...browserHeaders } = headers;
      const response = await fetchImpl(request.url, { headers: browserHeaders, signal: AbortSignal.timeout(request.timeoutMs) });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => (responseHeaders[key] = value));
      return { status: response.status, text: await response.text(), headers: responseHeaders };
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "TimeoutError") throw error;
      throw new ProviderError("network", `Réseau injoignable : ${String((error as Error)?.message ?? error)}`);
    }
  };

  const perform = async (request: HttpRequest): Promise<unknown> => {
    const host = new URL(request.url).host;
    await acquire(host);
    try {
      const response = await send(request);
      if (response.status === 429) {
        throw new ProviderError("rateLimited", `Débit limité par ${host}`, {
          status: 429,
          retryAfterMs: retryAfterMs(response.headers),
        });
      }
      if (response.status >= 400) {
        throw new ProviderError("http", `Réponse ${response.status} de ${host}`, { status: response.status });
      }
      if (response.text.length > maxChars) {
        throw new ProviderError("tooLarge", `Réponse de ${host} trop volumineuse (${response.text.length} caractères)`);
      }
      try {
        return JSON.parse(response.text);
      } catch {
        throw new ProviderError("parse", `Réponse illisible de ${host}`);
      }
    } finally {
      release(host);
    }
  };

  return {
    getJson<T>(request: HttpRequest): Promise<T> {
      // Deux demandes identiques en vol n'en font qu'une ; chacune garde son
      // propre signal d'annulation.
      let pending = inFlight.get(request.url);
      if (!pending) {
        pending = perform(request).finally(() => inFlight.delete(request.url));
        inFlight.set(request.url, pending);
      }
      return raceSignal(pending, request.signal) as Promise<T>;
    },
  };
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

function nativeHttp(): NativeHttp | null {
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (capacitor?.isNativePlatform?.() !== true) return null;
  return (capacitor.Plugins?.CapacitorHttp as NativeHttp | undefined) ?? null;
}

let shared: HttpClient | null = null;

/** Le client de l'application : natif dans l'APK, `fetch` ailleurs. */
export function transportHttp(): HttpClient {
  shared ??= createHttpClient({ userAgent: transportUserAgent(), native: nativeHttp() });
  return shared;
}
