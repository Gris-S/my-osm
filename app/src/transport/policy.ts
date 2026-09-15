import { CONFIG } from "../config";
import type { Capability } from "./provider";

// ---------------------------------------------------------------------------
// Les réglages chiffrés de la couche transport, en un seul endroit.
//
// Chaque valeur vient du document d'architecture (§2e délais et reprises,
// §2f cache, §2g budget) : les changer, c'est changer un engagement, donc
// mettre le document à jour dans le même commit.
// ---------------------------------------------------------------------------

export interface CapabilityPolicy {
  /** Délai d'une tentative. */
  timeoutMs: number;
  /** Attente avant chaque reprise ; la longueur du tableau est le nombre de reprises. */
  retryDelaysMs: readonly number[];
  /** Échecs consécutifs qui ouvrent le disjoncteur, et durée d'ouverture. */
  breaker: { failures: number; openMs: number };
}

const MINUTE = 60_000;

export const CAPABILITY_POLICY: Record<Capability, CapabilityPolicy> = {
  places: { timeoutMs: 8_000, retryDelaysMs: [], breaker: { failures: 3, openMs: 5 * MINUTE } },
  stops: { timeoutMs: 10_000, retryDelaysMs: [1_000, 4_000], breaker: { failures: 3, openMs: 10 * MINUTE } },
  stationDetails: { timeoutMs: 8_000, retryDelaysMs: [1_000], breaker: { failures: 3, openMs: 5 * MINUTE } },
  departures: { timeoutMs: 8_000, retryDelaysMs: [1_000], breaker: { failures: 3, openMs: 5 * MINUTE } },
  shapes: { timeoutMs: 10_000, retryDelaysMs: [1_000], breaker: { failures: 3, openMs: 10 * MINUTE } },
  stopsOfLine: { timeoutMs: 10_000, retryDelaysMs: [1_000], breaker: { failures: 3, openMs: 10 * MINUTE } },
  alerts: { timeoutMs: 8_000, retryDelaysMs: [1_000], breaker: { failures: 3, openMs: 5 * MINUTE } },
  journeys: { timeoutMs: 20_000, retryDelaysMs: [], breaker: { failures: 2, openMs: 5 * MINUTE } },
  exits: { timeoutMs: 10_000, retryDelaysMs: [1_000], breaker: { failures: 3, openMs: 10 * MINUTE } },
};

const DAY = 24 * 60 * MINUTE;

/** Durées de vie en cache (§2f). `allowStale` : servie périmée pendant qu'on rafraîchit. */
export const CACHE_POLICY = {
  stopsTile: { ttlMs: 7 * DAY, allowStale: true },
  station: { ttlMs: DAY, allowStale: true },
  lines: { ttlMs: 7 * DAY, allowStale: true },
  shape: { ttlMs: 7 * DAY, allowStale: true },
  /** Jamais servi périmé : un départ « à quai » d'il y a deux minutes est faux. */
  realtimeDepartures: { ttlMs: 30_000, allowStale: false },
  scheduledDepartures: { ttlMs: 5 * MINUTE, allowStale: false },
  alerts: { ttlMs: 5 * MINUTE, allowStale: true },
  journeys: { ttlMs: MINUTE, allowStale: false },
  places: { ttlMs: 60 * MINUTE, allowStale: true },
  notCovered: { ttlMs: DAY, allowStale: true },
} as const;

/** Budget d'appels réseau externes par interaction (§2g), vérifié par les tests. */
export const REQUEST_BUDGET = {
  appStart: 0,
  viewportSettled: 3,
  stationOpened: 1,
  departuresOpened: 2,
  lineShape: 1,
  journey: 1,
  regionChangeToPrevious: 0,
} as const;

/** Appels simultanés au plus vers un même hôte. */
export const MAX_CONCURRENT_PER_HOST = 4;

/** Taille maximale d'une réponse lue, en caractères (≈ octets pour du JSON). */
export const RESPONSE_MAX_CHARS = 5_000_000;

/** Entrées au plus dans le cache mémoire de la couche transport. */
export const MEMORY_CACHE_MAX_ENTRIES = 400;

/**
 * Identifie l'application auprès des services (exigé par Transitous et par les
 * politiques d'usage d'OSM) : nom, version, et l'adresse publique du projet
 * comme contact — jamais une adresse personnelle.
 */
export function transportUserAgent(): string {
  return `MY-OSM/${__APP_VERSION__} (+${CONFIG.PROJECT_URL})`;
}
