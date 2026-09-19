import type { LonLat } from "../types";
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
