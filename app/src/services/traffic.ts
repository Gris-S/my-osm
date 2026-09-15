import { CONFIG } from "../config";
import { relayedFetch } from "./native";

// ---------------------------------------------------------------------------
// Trafic routier en direct — Bison Futé, réseau routier national.
//
// La source est le **Point d'Accès National** (`transport.data.gouv.fr`), qui
// republie en continu les événements des directions interdépartementales des
// routes au format DATEX II : bouchons, accidents, chantiers, fermetures, avec
// leur gravité et une description en français. Gratuite, sans clé, nationale,
// officielle.
//
// Trois choses mesurées, à connaître avant d'y toucher :
//
//  - **Un seul fichier agrège tout le pays** : 11 564 enregistrements dont
//    2 576 localisés, 4,3 Mo bruts mais **198 Ko compressés**. Il n'y a donc
//    rien à paginer ni à filtrer côté serveur — on lit tout, on garde ce qui
//    est localisé, et l'emprise visible fait le tri à l'affichage.
//  - **Le flux n'envoie aucun en-tête d'origine croisée**, alors qu'il est
//    pourtant servi en HTTPS. Il est donc relayé par le serveur de
//    développement (`vite.config.ts`), et `TRAFFIC_EVENTS_URL` est **relatif**
//    pour cette raison — ne pas le remettre en absolu, cela fonctionne en ligne
//    de commande et échoue silencieusement dans le navigateur. Dans l'APK, où
//    il n'y a pas de serveur, `relayedFetch` l'appelle par le natif.
//  - **Le XML porte un préfixe de namespace** (`ns2:`) que la réponse d'un
//    fichier isolé n'a pas. La lecture ne doit donc jamais chercher un nom de
//    balise nu.
//
// L'autre flux de Bison Futé, TRAFICOLOR — l'état coloré du trafic autour des
// grandes agglomérations — a été écarté : il désigne ses points de mesure par
// identifiant et **ne publie pas leur géométrie**, si bien qu'il n'y a rien à
// tracer. Les routes colorées viennent, elles, de TomTom quand une clé est
// renseignée (voir `MapView`).
// ---------------------------------------------------------------------------

/** Ce qu'on retient d'un événement routier. */
export interface TrafficEvent {
  id: string;
  /** Gravité annoncée par la source, normalisée. */
  severity: TrafficSeverity;
  /** La nature de l'événement, telle que DATEX II la classe. */
  kind: TrafficKind;
  /** Description en français, quand la source en donne une. */
  description: string;
  /** La route concernée, quand elle est nommée (« A13 », « N12 »). */
  road: string;
  lon: number;
  lat: number;
  /** Fin du tronçon concerné, quand la source donne deux points. */
  end?: { lon: number; lat: number };
}

export type TrafficSeverity = "low" | "medium" | "high";

export type TrafficKind = "jam" | "accident" | "roadworks" | "closure" | "other";

/**
 * Correspondance entre les types DATEX II et les cinq familles affichées.
 *
 * Les motifs sont écrits d'après les types **réellement rencontrés** dans le
 * flux (relevé du 9 septembre 2026, sur 777 événements localisés) :
 * `MaintenanceWorks` 225, `RoadOrCarriagewayOrLaneManagement` 171,
 * `ReroutingManagement` 127, `VehicleObstruction` 61, `AbnormalTraffic` 30,
 * `Accident` 8. L'ordre compte : le premier motif qui reconnaît un type
 * l'emporte.
 */
const KINDS: { test: RegExp; kind: TrafficKind }[] = [
  { test: /AbnormalTraffic/, kind: "jam" },
  { test: /Accident|Obstruction/, kind: "accident" },
  { test: /MaintenanceWorks|ConstructionWorks|Roadworks/, kind: "roadworks" },
  { test: /RoadOrCarriagewayOrLaneManagement|NetworkManagement|Rerouting|Closure/, kind: "closure" },
];

const SEVERITIES: Record<string, TrafficSeverity> = {
  none: "low",
  lowest: "low",
  low: "low",
  medium: "medium",
  high: "high",
  highest: "high",
};

interface CacheEntry {
  at: number;
  value: TrafficEvent[];
}

let cache: CacheEntry | null = null;
let inFlight: Promise<TrafficEvent[]> | null = null;

/**
 * Les événements routiers en cours.
 *
 * Mis en cache pour `TRAFFIC_TTL_MS` : le flux est republié en continu, mais le
 * relire plus souvent ne rendrait pas des bouchons plus frais et coûterait deux
 * cents kilo-octets à chaque fois. Les appels concurrents partagent la même
 * requête — allumer le calque et déplacer la carte ne doit pas en lancer deux.
 */
export async function getTrafficEvents(signal?: AbortSignal): Promise<TrafficEvent[]> {
  if (cache && Date.now() - cache.at < CONFIG.TRAFFIC_TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await relayedFetch(CONFIG.TRAFFIC_EVENTS_URL, { signal });
    if (!res.ok) throw new Error(`Trafic indisponible (${res.status})`);
    const events = parseDatex(await res.text());
    cache = { at: Date.now(), value: events };
    return events;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Lit le DATEX II.
 *
 * `DOMParser` plutôt qu'une bibliothèque : il est dans tous les navigateurs, et
 * quatre mégaoctets d'XML se lisent en une fraction de seconde. Les noms de
 * balises sont cherchés **sans namespace** (`getElementsByTagNameNS("*", …)`)
 * parce que le préfixe change d'une publication à l'autre.
 */
function parseDatex(xml: string): TrafficEvent[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];

  const events: TrafficEvent[] = [];
  const situations = doc.getElementsByTagNameNS("*", "situation");

  for (const situation of Array.from(situations)) {
    const severity = SEVERITIES[text(situation, "overallSeverity")] ?? "medium";
    const records = situation.getElementsByTagNameNS("*", "situationRecord");

    for (const record of Array.from(records)) {
      const points = coordinatesOf(record);
      // Un enregistrement sans coordonnées n'est pas affichable. Mesuré : deux
      // mille cinq cents sur onze mille en portent — les autres décrivent des
      // arrêtés ou des périodes, sans localisation.
      if (!points.length) continue;

      const type = record.getAttribute("xsi:type") ?? record.getAttribute("type") ?? "";
      events.push({
        id: record.getAttribute("id") ?? `${points[0].lon},${points[0].lat}`,
        severity,
        kind: KINDS.find((entry) => entry.test.test(type))?.kind ?? "other",
        description: descriptionOf(record),
        road: roadNumber(record),
        lon: points[0].lon,
        lat: points[0].lat,
        end: points[1],
      });
    }
  }

  return events;
}

/** Les points d'un enregistrement : un seul, ou les deux bouts d'un tronçon. */
function coordinatesOf(record: Element): { lon: number; lat: number }[] {
  const nodes = record.getElementsByTagNameNS("*", "pointCoordinates");
  const points: { lon: number; lat: number }[] = [];
  for (const node of Array.from(nodes).slice(0, 2)) {
    const lat = Number(text(node, "latitude"));
    const lon = Number(text(node, "longitude"));
    // Le couple (0, 0) est au large de l'Afrique : c'est une valeur non
    // renseignée, pas un point du réseau routier français.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (!lat && !lon)) continue;
    points.push({ lon, lat });
  }
  return points;
}

/**
 * La description lisible.
 *
 * Un enregistrement porte plusieurs commentaires, distingués par leur
 * `commentType`, et **un seul renseigne sur l'événement** : `description`.
 * Les autres sont un `locationDescriptor` — « situé 6920 m à l'ouest de
 * Le Sauze », qui redit ce que la carte montre déjà — ou une `internalNote`,
 * qui nomme le centre d'exploitation. Mesuré : 336 descriptions pour 2 200
 * descripteurs de lieu ; prendre le plus long texte, comme on serait tenté de
 * le faire, revient à afficher l'adresse à la place de l'événement.
 */
function descriptionOf(record: Element): string {
  for (const comment of Array.from(record.getElementsByTagNameNS("*", "generalPublicComment"))) {
    if (text(comment, "commentType") !== "description") continue;
    const value = text(comment, "value");
    if (value.length > 3) return value;
  }
  return "";
}

/**
 * Le numéro de route, écrit comme sur les panneaux : la source le remplit de
 * zéros (`A0033`, `N0004`) pour l'aligner sur cinq caractères.
 */
function roadNumber(record: Element): string {
  const raw = text(record, "roadNumber");
  return raw.replace(/^([A-Z]+)0*(\d+)/, "$1$2");
}

function text(parent: Element, tag: string): string {
  return (parent.getElementsByTagNameNS("*", tag)[0]?.textContent ?? "").trim();
}
