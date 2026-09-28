import type { LonLat } from "../types";
import { distance } from "./geo";
import type { TransitJourney, TransitLeg, TransitLine } from "../transport/journeyView";

// ---------------------------------------------------------------------------
// Un trajet en transports, découpé en **actions**.
//
// Le détail d'un trajet énumère des étapes ; le guidage, lui, énumère des
// gestes, et une étape en transport en demande deux : monter, puis descendre.
// C'est cette distinction qui fait tout le comportement demandé — « quand on
// est dans le nouveau transport, mets là où on descend ».
//
// Chaque action porte l'instant où elle **devient l'action en cours**, et non
// celui où elle se termine :
//
//   - la marche, quand on se met à marcher ;
//   - la montée, quand on arrive à l'arrêt (fin de la marche précédente, ou
//     descente du véhicule précédent) — on attend alors sur le quai ;
//   - la descente, **au départ du véhicule** : dès qu'il roule, la seule chose
//     à savoir est où l'on descend ;
//   - l'arrivée, à la fin.
//
// Le guidage n'a plus qu'à chercher la dernière action dont l'heure est passée.
// ---------------------------------------------------------------------------

export type TransitStepKind = "walk" | "board" | "alight" | "arrive";

export interface TransitStep {
  kind: TransitStepKind;
  /** Rang de l'étape du trajet dont cette action fait partie. */
  legIndex: number;
  /** Instant où l'action devient l'action en cours. */
  at: Date;
  /** Instant où elle cesse de l'être : l'heure de l'action suivante. */
  until: Date;
  /** L'arrêt ou le lieu concerné. */
  place: string;
  line?: TransitLine;
  direction?: string;
  /** Nombre d'arrêts de la montée à la descente. */
  stopCount?: number;
  durationSeconds?: number;
  /** Où se trouve l'action, quand on le sait : sert au recalage par le GPS. */
  coord?: LonLat;
}

/** Le dernier point d'une étape, d'après son tracé ou ses arrêts. */
function endOf(leg: TransitLeg): LonLat | undefined {
  const stop = leg.stops?.[leg.stops.length - 1];
  if (stop) return { lon: stop.lon, lat: stop.lat };
  const coords = leg.geometry?.coordinates;
  const last = coords?.[coords.length - 1];
  return last ? { lon: last[0], lat: last[1] } : undefined;
}

/** Le premier point d'une étape. */
function startOf(leg: TransitLeg): LonLat | undefined {
  const stop = leg.stops?.[0];
  if (stop) return { lon: stop.lon, lat: stop.lat };
  const first = leg.geometry?.coordinates?.[0];
  return first ? { lon: first[0], lat: first[1] } : undefined;
}

/**
 * Découpe un trajet en actions.
 *
 * Une montée prend pour heure celle où l'on **arrive à l'arrêt** — la fin de ce
 * qui précède — et non celle du départ du véhicule : entre les deux, on attend
 * sur le quai, et c'est bien « prendre la ligne A » qu'il faut avoir sous les
 * yeux, pas encore la station de descente.
 */
export function buildTransitSteps(journey: TransitJourney): TransitStep[] {
  const steps: TransitStep[] = [];

  journey.legs.forEach((leg, legIndex) => {
    if (leg.kind === "walk") {
      steps.push({
        kind: "walk",
        legIndex,
        at: leg.departure,
        until: leg.arrival,
        place: leg.to ?? "",
        durationSeconds: leg.durationSeconds,
        coord: endOf(leg),
      });
      return;
    }

    // On est à l'arrêt dès que l'étape précédente s'achève ; à défaut — le
    // trajet commence par le transport — dès l'heure du trajet lui-même.
    const previous = steps[steps.length - 1];
    steps.push({
      kind: "board",
      legIndex,
      at: previous?.until ?? journey.departure,
      until: leg.departure,
      place: leg.from ?? "",
      line: leg.line,
      direction: leg.direction,
      coord: startOf(leg),
    });
    steps.push({
      kind: "alight",
      legIndex,
      at: leg.departure,
      until: leg.arrival,
      place: leg.to ?? "",
      line: leg.line,
      direction: leg.direction,
      stopCount: leg.stopCount,
      coord: endOf(leg),
    });
  });

  const last = journey.legs[journey.legs.length - 1];
  steps.push({
    kind: "arrive",
    legIndex: journey.legs.length - 1,
    at: journey.arrival,
    // L'arrivée ne cesse jamais d'être l'action en cours : c'est la dernière.
    until: new Date(journey.arrival.getTime() + 3600_000),
    place: last?.to ?? "",
    coord: last ? endOf(last) : undefined,
  });

  // Une montée dont l'heure d'arrivée à l'arrêt tombe après le départ du
  // véhicule — la marche précédente déborde, cela arrive quand Navitia serre
  // une correspondance — laisserait une action de durée négative, jamais
  // courante. On la fait commencer au plus tard au départ.
  for (const step of steps) {
    if (step.at.getTime() > step.until.getTime()) step.at = step.until;
  }

  return steps;
}

/**
 * L'action en cours d'après l'horaire : la dernière dont l'heure est passée.
 *
 * Avant l'heure de départ du trajet — on a lancé le guidage en avance — c'est
 * la première.
 */
export function scheduledStep(steps: TransitStep[], now: number): number {
  let index = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].at.getTime() <= now) index = i;
  }
  return index;
}

/** Combien d'arrêts restent avant la descente, quand la desserte est connue. */
export function remainingStops(leg: TransitLeg | undefined, now: number): number | null {
  if (!leg?.stops || leg.stops.length < 2) return null;
  // Le premier arrêt est celui de la montée : il ne compte pas dans ce qui
  // reste à parcourir.
  const ahead = leg.stops.slice(1).filter((stop) => stop.at.getTime() > now);
  return ahead.length;
}

/** Modes sans accès direct à la rue : on en sort par une sortie numérotée. */
export const ENCLOSED_MODES = /m[ée]tro|rer|train|transilien|funiculaire/i;

const enclosed = (line: TransitLine | undefined) => !!line?.mode && ENCLOSED_MODES.test(line.mode);

/**
 * Faut-il indiquer une sortie de station à la descente `index` ?
 *
 * Seulement quand on descend d'un mode fermé **pour aller dehors**. La règle
 * est générale, et c'est une capture à Auber qui l'a apprise (18 septembre
 * 2026) : descendre du RER A pour prendre le 9 à Havre-Caumartin se fait par
 * les couloirs, et « Sortie 1 — r. du Havre » y envoyait dehors.
 *
 *  - vers un bus, un tram ou l'arrivée, on sort : oui ;
 *  - vers un métro, un RER ou un train, on reste dedans — **sauf** si la marche
 *    passe par la rue, ce que Navitia dit en la calculant sur la voirie
 *    (`street_network`) au lieu d'une correspondance déclarée (`transfer`).
 *
 * Une correspondance déclarée peut elle aussi traverser une rue (Javel, RER C ↔
 * métro 10) : on ne dit rien, le fléchage « Correspondance » guide mieux qu'un
 * numéro de sortie. Mesuré le 19 septembre 2026 : Haussmann-Saint-Lazare ↔
 * Saint-Lazare, Richelieu-Drouot, Nation et Javel en `transfer`, Concorde →
 * Madeleine à pied en `street_network`. Une source qui ne dit pas le type de
 * marche (`connection` absent) suit la règle des modes.
 */
export function exitWanted(steps: TransitStep[], index: number, legs: TransitLeg[]): boolean {
  const alight = steps[index];
  if (alight?.kind !== "alight" || !enclosed(alight.line)) return false;
  const following = steps.slice(index + 1);
  const boardAt = following.findIndex((step) => step.kind === "board" || step.kind === "arrive");
  const next = boardAt >= 0 ? following[boardAt] : undefined;
  if (next?.kind !== "board" || !enclosed(next.line)) return true;
  const walks = following.slice(0, boardAt).filter((step) => step.kind === "walk");
  return walks.some((step) => legs[step.legIndex]?.connection === false);
}

/**
 * La ligne vers laquelle on fait correspondance **sans sortir**, à la descente
 * `index` : celle qu'il faut chercher sur le fléchage « Correspondance ». `null`
 * dès qu'une sortie se dit (voir `exitWanted`) ou que la suite n'est pas un
 * mode fermé. C'est ce qui remplace la sortie dans une correspondance déclarée
 * — y compris celles qui traversent une rue, comme Javel, où la signalétique
 * guide jusqu'à l'autre station.
 */
export function connectionTo(steps: TransitStep[], index: number, legs: TransitLeg[]): TransitLine | null {
  const alight = steps[index];
  if (alight?.kind !== "alight" || !enclosed(alight.line) || exitWanted(steps, index, legs)) return null;
  const next = steps.slice(index + 1).find((step) => step.kind === "board" || step.kind === "arrive");
  return next?.kind === "board" && enclosed(next.line) ? (next.line ?? null) : null;
}

// ---------------------------------------------------------------------------
// Le recalage par le GPS.
//
// Le plan dit « T1, puis T2 » ; on a pris T4, et l'on se retrouve dans T2
// (demande explicite, 28 septembre 2026). Le guidage doit alors se remettre à
// T2 au lieu de rester sur T1. Le GPS reconnaît pour cela deux choses : le
// lieu d'une action (un arrêt de montée ou de descente), et les arrêts
// **intermédiaires** d'une ligne du trajet — y passer, c'est être dedans.
//
// Près de l'action en cours — celle d'avant ou celle d'après —, le relevé
// suffit, comme avant. **Plus loin, il faut une preuve**, parce qu'un trajet
// repasse souvent près de ses propres arrêts : la marche du début longe le bus
// de la fin. La preuve est l'une de ces deux :
//
//   - **rester** près d'un arrêt du trajet : on l'attend ;
//   - **passer deux arrêts successifs** d'une même ligne, dans son sens : on
//     est dedans.
//
// Jamais plus d'une action en arrière : deux stations proches se
// confondraient sur une ligne qui revient sur ses pas.
// ---------------------------------------------------------------------------

/** En deçà de cette distance du lieu d'une action voisine, on y est. */
export const CONFIRM_METERS = 90;
/** Plus serré pour une action lointaine : il faut être à l'arrêt, pas à côté. */
export const FAR_METERS = 40;
/** Temps passé près d'un arrêt lointain avant de s'y recaler. */
export const DWELL_MS = 30_000;
/** Combien de temps un arrêt passé attend le suivant de la même ligne. */
export const RIDE_MEMORY_MS = 10 * 60_000;

/** Ce que le recalage retient d'un relevé à l'autre, en attendant sa preuve. */
export interface ResyncMemory {
  /** L'action où l'on se recalerait. */
  target: number;
  /** Depuis quand on est près de ce lieu. */
  since: number;
  /** Arrêt intermédiaire reconnu : sa ligne (rang d'étape) et son rang. */
  ride?: { leg: number; order: number };
}

interface Match {
  target: number;
  meters: number;
  ride?: { leg: number; order: number };
}

/** Les lieux du trajet où se trouve `here`, de la première action à la dernière. */
function matchesAt(steps: TransitStep[], legs: TransitLeg[], here: LonLat, from: number, radius: number): Match[] {
  const found: Match[] = [];
  for (let i = Math.max(0, from); i < steps.length; i++) {
    const step = steps[i];
    if (step.coord) {
      const meters = distance(here, step.coord);
      // Être au lieu d'une marche ou d'une descente, c'est l'avoir **finie** :
      // l'action suivante commence.
      if (meters <= radius) {
        found.push({ target: step.kind === "walk" || step.kind === "alight" ? Math.min(i + 1, steps.length - 1) : i, meters });
      }
    }
    // Les arrêts intermédiaires d'une ligne : on roule vers sa descente.
    const stops = step.kind === "alight" ? legs[step.legIndex]?.stops : undefined;
    if (stops && stops.length > 2) {
      for (let order = 1; order < stops.length - 1; order++) {
        const meters = distance(here, stops[order]);
        if (meters <= radius) found.push({ target: i, meters, ride: { leg: step.legIndex, order } });
      }
    }
  }
  return found;
}

/**
 * L'action où recaler le guidage d'après un relevé, ou `index: null` pour ne
 * rien changer. `memory` se repasse d'un relevé à l'autre : c'est elle qui
 * porte la preuve en cours.
 */
export function resyncStep(
  steps: TransitStep[],
  legs: TransitLeg[],
  here: LonLat,
  current: number,
  now: number,
  memory: ResyncMemory | null
): { index: number | null; memory: ResyncMemory | null } {
  // Près du plan : le relevé suffit.
  const near = matchesAt(steps, legs, here, current - 1, CONFIRM_METERS).filter((match) => match.target <= current + 1);
  if (near.length) {
    const target = near[0].target;
    return { index: target === current ? null : target, memory: null };
  }

  // Plus loin : la première action reconnue, preuve à l'appui.
  const match = matchesAt(steps, legs, here, current + 2, FAR_METERS).find((m) => m.target > current + 1);
  if (!match) {
    // Entre deux arrêts d'une ligne, on n'est près d'aucun : l'arrêt passé
    // reste en mémoire, le temps d'atteindre le suivant. L'attente, elle,
    // s'arrête quand on quitte le lieu.
    const keep = memory?.ride && now - memory.since < RIDE_MEMORY_MS;
    return { index: null, memory: keep ? memory : null };
  }

  // Deux arrêts de la même ligne, dans son sens : on est dedans.
  const before = memory?.ride;
  if (match.ride && before && before.leg === match.ride.leg && match.ride.order > before.order) {
    return { index: match.target, memory: null };
  }
  // Resté au même lieu assez longtemps : on y attend.
  const sameSpot =
    memory !== null &&
    memory.target === match.target &&
    (match.ride ? memory.ride?.order === match.ride.order : !memory.ride);
  if (sameSpot && now - memory.since >= DWELL_MS) {
    return { index: match.target, memory: null };
  }
  return { index: null, memory: { target: match.target, since: sameSpot ? memory.since : now, ride: match.ride } };
}
