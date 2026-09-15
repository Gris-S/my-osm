import type {
  Alert,
  AlertScope,
  CanonicalId,
  DepartureGroup,
  DepartureOptions,
  GeoTile,
  Journey,
  JourneyOptions,
  Place,
  Position,
  ProviderId,
  Quay,
  Shape,
  Station,
} from "./model";

// ---------------------------------------------------------------------------
// L'interface d'un fournisseur de transports (§3.2 du document d'architecture).
//
// Un fournisseur n'implémente que ce qu'il sait faire et le déclare dans le
// registre des régions ; l'orchestrateur ne l'appelle que pour ces capacités.
// Chaque appel reçoit un `AbortSignal` : une requête devenue inutile — carte
// déplacée, fiche fermée, région quittée — doit pouvoir s'arrêter.
// ---------------------------------------------------------------------------

export type Capability =
  | "places"
  | "stops"
  | "stationDetails"
  | "departures"
  | "shapes"
  | "stopsOfLine"
  | "alerts"
  | "journeys"
  | "exits";

export interface TransportProvider {
  readonly id: ProviderId;
  searchPlaces?(query: string, near: Position, signal: AbortSignal): Promise<Place[]>;
  getStopsInViewport?(tile: GeoTile, signal: AbortSignal): Promise<Station[]>;
  getStationDetails?(stationId: CanonicalId, signal: AbortSignal): Promise<Station>;
  getDepartures?(stationId: CanonicalId, options: DepartureOptions, signal: AbortSignal): Promise<DepartureGroup[]>;
  getLineShape?(ref: { lineId: CanonicalId; tripId?: string }, signal: AbortSignal): Promise<Shape | null>;
  getStopsOfLine?(lineId: CanonicalId, signal: AbortSignal): Promise<Quay[]>;
  getAlerts?(scope: AlertScope, signal: AbortSignal): Promise<Alert[]>;
  planJourney?(from: Position, to: Position, options: JourneyOptions, signal: AbortSignal): Promise<Journey[]>;
  /** Libère minuteurs et abonnements quand la région est quittée. */
  dispose?(): void;
}

export type ProviderErrorKind = "network" | "http" | "rateLimited" | "parse" | "tooLarge" | "invalidParameter";

/** Une erreur de source, typée pour décider d'une reprise ou d'un repli. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** Délai demandé par la source (`Retry-After`), pour une erreur 429. */
  readonly retryAfterMs?: number;

  constructor(kind: ProviderErrorKind, message: string, details: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
  }
}

/**
 * Vrai si une nouvelle tentative a une chance d'aboutir : réseau, délai, erreur
 * serveur. Jamais pour une erreur de requête (4xx), une limitation de débit
 * (on respecte `Retry-After` au lieu d'insister) ou une réponse illisible.
 */
export function isRetryable(error: unknown): boolean {
  if ((error as { name?: string } | null)?.name === "TimeoutError") return true;
  if (!(error instanceof ProviderError)) return false;
  if (error.kind === "network") return true;
  return error.kind === "http" && (error.status ?? 0) >= 500;
}
