import { apiKey, type ApiKeyId } from "../services/apiKeys";
import { transportHttp } from "./httpClient";
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

let instance: TransportOrchestrator | null = null;

export function transport(): TransportOrchestrator {
  instance ??= new TransportOrchestrator({
    loaders: LOADERS,
    http: transportHttp(),
    hasKey: (id) => apiKey(id as ApiKeyId).trim().length > 0,
  });
  return instance;
}
