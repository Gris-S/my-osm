import { apiKey, type ApiKeyId } from "../services/apiKeys";
import { transportHttp, type HttpClient } from "./httpClient";
import { TransportOrchestrator, type ProviderLoader } from "./orchestrator";

// ---------------------------------------------------------------------------
// Point d'entrée de la plateforme transport : l'orchestrateur de l'application.
//
// Les adaptateurs sont des imports dynamiques : aucun n'est chargé tant que sa
// région n'est pas active et qu'une capacité ne l'a pas demandé. Ajouter un
// protocole, c'est ajouter une ligne ici et une entrée au registre
// (`regions.json`).
// ---------------------------------------------------------------------------

const LOADERS: Record<string, ProviderLoader> = {
  idfm: () => import("./providers/idfm").then((module) => module.createIdfmProvider),
  transitous: () => import("./providers/transitous").then((module) => module.createTransitousProvider),
};

interface RequestTrace {
  at: number;
  host: string;
  path: string;
  ms: number;
  outcome: string;
}

/**
 * Dans l'APK de travail, chaque appel des adaptateurs est noté dans
 * `window.__myosm.transportRequests` (les 300 derniers). Ils passent par le
 * natif : l'inspecteur de la WebView ne les voit pas, et c'est pourtant sur eux
 * que se vérifie le budget de requêtes. Deux demandes identiques partagées en
 * vol comptent deux lignes pour un seul appel réseau.
 */
function traced(client: HttpClient): HttpClient {
  if (!__DIAGNOSTICS__ || typeof window === "undefined") return client;
  const traces: RequestTrace[] = [];
  const holder = window as unknown as { __myosm?: Record<string, unknown> };
  holder.__myosm = { ...holder.__myosm, transportRequests: traces };
  return {
    async getJson<T>(request: Parameters<HttpClient["getJson"]>[0]): Promise<T> {
      const url = new URL(request.url);
      const trace: RequestTrace = { at: Date.now(), host: url.host, path: `${url.pathname}${url.search}`.slice(0, 160), ms: 0, outcome: "pending" };
      traces.push(trace);
      if (traces.length > 300) traces.shift();
      const started = performance.now();
      try {
        const value = await client.getJson<T>(request);
        trace.outcome = "ok";
        return value;
      } catch (error) {
        trace.outcome = (error as Error)?.name === "AbortError" ? "aborted" : String((error as Error)?.message ?? error).slice(0, 80);
        throw error;
      } finally {
        trace.ms = Math.round(performance.now() - started);
      }
    },
  };
}

let instance: TransportOrchestrator | null = null;

export function transport(): TransportOrchestrator {
  instance ??= new TransportOrchestrator({
    loaders: LOADERS,
    http: traced(transportHttp()),
    hasKey: (id) => apiKey(id as ApiKeyId).trim().length > 0,
  });
  return instance;
}
