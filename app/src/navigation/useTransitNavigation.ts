import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LonLat } from "../types";
import type { TransitJourney, TransitLine } from "../transport/journeyView";
import { distance } from "./geo";
import { bestExit, type StationExit } from "./exits";
import {
  buildTransitSteps,
  connectionTo,
  exitWanted,
  remainingStops,
  scheduledStep,
  type TransitStep,
} from "./transitSteps";
import { useNavPosition } from "./useNavPosition";
import { setJourneyStopHints } from "../services/idfm";
import type { NavMapState } from "./useNavigation";
import { useWakeLock } from "./useWakeLock";

// ---------------------------------------------------------------------------
// Le guidage d'un trajet en transports.
//
// Il ne ressemble pas au guidage à pied, et c'est pourquoi il vit à part : un
// piéton avance dans l'espace, un voyageur avance dans **l'horaire**. Sous
// terre, le GPS ne répond pas — c'est l'essentiel d'un trajet francilien — et
// la seule source qui sache où l'on en est est l'heure.
//
// D'où trois sources d'avancement, dans cet ordre de confiance :
//
//   1. **l'horaire** de Navitia, qui donne l'action en cours à tout instant ;
//   2. **le GPS**, quand il revient — en surface, sur un quai aérien, dans un
//      bus — et qui confirme alors qu'on est bien à l'arrêt annoncé ;
//   3. **l'utilisateur**, par deux boutons, parce qu'un train en retard rend
//      l'horaire faux et qu'il faut pouvoir le dire.
//
// Le geste manuel se garde sous la forme d'un **décalage en nombre d'actions**
// et non d'une action figée : le trajet continue d'avancer tout seul, avec une
// action d'avance ou de retard, ce qui est précisément ce qu'on constate quand
// une ligne prend du retard. Un relevé GPS qui reconnaît un arrêt remet ce
// décalage à ce qu'il devrait être.
// ---------------------------------------------------------------------------

/** Cadence de l'horloge du guidage. */
const TICK_MS = 1000;

/**
 * Vitesse de la simulation : une minute d'horaire par seconde réelle divisée
 * par vingt. Un trajet de vingt minutes se déroule en une minute — assez pour
 * voir défiler montées, descentes et correspondances sans prendre le RER.
 */
const SIMULATION_RATE = 20;

/** En deçà de cette distance d'un arrêt, le GPS confirme qu'on y est. */
const CONFIRM_METERS = 90;

/**
 * Les modes dont les stations ont des sorties. Un arrêt de bus ou de tramway
 * est sur le trottoir : il n'a pas de sortie, et en proposer une — mesuré,
 * une station de métro voisine en fournit toujours une à moins de 350 m —
 * enverrait sous terre quelqu'un qui est déjà dehors.
 */

export interface TransitNavSession {
  active: boolean;
  journey: TransitJourney | null;
  steps: TransitStep[];
  /** Rang de l'action en cours. */
  index: number;
  /** L'action en cours, et celles qui restent. */
  current: TransitStep | null;
  upcoming: TransitStep[];
  /** Arrêts restants avant la descente, quand la desserte est connue. */
  stopsLeft: number | null;
  /** La sortie à prendre en descendant, quand la station en déclare une. */
  exit: StationExit | null;
  /** À une descente sans sortie : la ligne à rejoindre par les couloirs. */
  connection: TransitLine | null;
  /** Décalage manuel, en nombre d'actions, par rapport à l'horaire. */
  offset: number;
  advance: () => void;
  back: () => void;
  simulating: boolean;
  toggleSimulation: () => void;
  start: (journey: TransitJourney) => void;
  stop: () => void;
  map: NavMapState | null;
}

export function useTransitNavigation(): TransitNavSession {
  const [journey, setJourney] = useState<TransitJourney | null>(null);
  const [offset, setOffset] = useState(0);
  const [simulating, setSimulating] = useState(false);
  const [exit, setExit] = useState<StationExit | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Décalage de l'horloge simulée, en millisecondes. Il grandit à chaque
  // battement tant que la simulation tourne, et repart de zéro avec elle.
  const simulatedRef = useRef(0);
  const active = journey !== null;
  // Suivre un trajet, c'est regarder l'écran par intermittence pendant une
  // heure : il ne doit pas s'éteindre entre deux correspondances.
  useWakeLock(active);

  const steps = useMemo(() => (journey ? buildTransitSteps(journey) : []), [journey]);

  const live = useNavPosition(active && !simulating);
  const fix = live.fix;

  // L'horloge. Elle bat toutes les secondes : les actions d'un trajet se
  // comptent en minutes, et un battement plus rapide ne ferait que multiplier
  // les rendus.
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const timer = window.setInterval(() => {
      const real = Date.now();
      if (simulating) simulatedRef.current += (real - last) * (SIMULATION_RATE - 1);
      last = real;
      const next = real + simulatedRef.current;
      // L'horloge bat chaque seconde pour ne pas rater l'instant d'une action,
      // mais ne **redessine** que si elle change ce qu'on voit : l'action prévue
      // ou le nombre d'arrêts restants. Sinon, toute l'application se
      // redessinait chaque seconde pour rien.
      setNow((previous) =>
        scheduledStep(stepsRef.current, previous) === scheduledStep(stepsRef.current, next) &&
        remainingStops(legRef.current, previous) === remainingStops(legRef.current, next)
          ? previous
          : next
      );
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, simulating]);

  const scheduled = steps.length ? scheduledStep(steps, now) : 0;
  const index = steps.length ? clamp(scheduled + offset, 0, steps.length - 1) : 0;
  const current = steps[index] ?? null;

  const indexRef = useRef(index);
  indexRef.current = index;
  const scheduledRef = useRef(scheduled);
  scheduledRef.current = scheduled;

  /** Place le guidage sur une action précise, en ajustant le décalage. */
  const goTo = useCallback((target: number) => {
    setOffset(target - scheduledRef.current);
  }, []);

  const advance = useCallback(() => goTo(Math.min(indexRef.current + 1, steps.length - 1)), [goTo, steps.length]);
  const back = useCallback(() => goTo(Math.max(indexRef.current - 1, 0)), [goTo]);

  const start = useCallback((next: TransitJourney) => {
    setJourney(next);
    setOffset(0);
    setSimulating(false);
    setExit(null);
    simulatedRef.current = 0;
    setNow(Date.now());
  }, []);

  // Les poteaux de montée du trajet, pour la fiche d'un arrêt ouverte en route
  // (voir `setJourneyStopHints`) : elle doit montrer la ligne qu'on va prendre.
  useEffect(() => {
    setJourneyStopHints(
      journey
        ? journey.legs.flatMap((leg) => {
            const arrid = leg.kind === "transit" ? leg.stopPointId?.match(/^stop_point:IDFM:(\d+)$/)?.[1] : undefined;
            const first = leg.stops?.[0];
            return arrid && first ? [{ name: first.name, lon: first.lon, lat: first.lat, arrid }] : [];
          })
        : []
    );
    return () => setJourneyStopHints([]);
  }, [journey]);

  const stop = useCallback(() => {
    setJourney(null);
    setOffset(0);
    setSimulating(false);
    setExit(null);
    simulatedRef.current = 0;
  }, []);

  // Recalage par le GPS. Il ne sert qu'à **confirmer** un arrêt : dès qu'un
  // relevé nous place sur le lieu d'une action, c'est celle-là qui est en
  // cours, quel que soit ce que dit l'horaire ou le décalage manuel. Il ne fait
  // jamais reculer de plus d'une action — deux stations proches se
  // confondraient sur une ligne qui revient sur ses pas.
  useEffect(() => {
    if (!active || !fix || !steps.length) return;
    const here = { lon: fix.lon, lat: fix.lat };
    const around = [indexRef.current - 1, indexRef.current, indexRef.current + 1];
    for (const candidate of around) {
      const step = steps[candidate];
      if (!step?.coord) continue;
      if (distance(here, step.coord) > CONFIRM_METERS) continue;
      // On est au lieu de cette action : la marche vers un arrêt et la descente
      // à un arrêt sont **finies** dès qu'on y est, l'action suivante commence.
      const reached = step.kind === "walk" || step.kind === "alight" ? candidate + 1 : candidate;
      if (reached !== indexRef.current) goTo(Math.min(reached, steps.length - 1));
      return;
    }
  }, [fix, active, steps, goTo]);

  // La sortie à prendre, cherchée pour la descente en cours ou imminente. Un
  // appel de plus au réseau : il n'est fait qu'au moment où l'indication va
  // servir, jamais pour tout le trajet d'avance.
  const alightStep = current?.kind === "alight" ? current : null;
  const exitStopKey = alightStep?.coord ? `${alightStep.coord.lon},${alightStep.coord.lat}` : null;
  // Sortie à indiquer ou non : voir `exitWanted` (`transitSteps.ts`).
  const enclosed = !!alightStep && !!journey && exitWanted(steps, index, journey.legs);

  useEffect(() => {
    setExit(null);
    if (!exitStopKey || !enclosed || !alightStep?.coord) return;
    const controller = new AbortController();
    let cancelled = false;
    // Vers où l'on va ensuite : le début de ce qui suit la descente. C'est lui
    // qui départage deux sorties d'une même station, parfois distantes de trois
    // cents mètres.
    const next = steps[index + 1]?.coord;
    bestExit(alightStep.coord, next, controller.signal)
      .then((found) => {
        if (!cancelled) setExit(found);
      })
      .catch(() => {
        /* source muette : on n'indique simplement pas de sortie */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitStopKey, enclosed]);

  const leg = journey?.legs[current?.legIndex ?? 0];
  // Lus par l'horloge, installée une fois pour tout le trajet.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const legRef = useRef(leg);
  legRef.current = leg;
  const stopsLeft = current?.kind === "alight" ? remainingStops(leg, now) : null;

  // Le cadrage : l'étape en cours, et non la position. Sous terre il n'y a pas
  // de position, et voir le tronçon qu'on parcourt vaut mieux qu'une carte
  // figée là où le signal s'est perdu.
  const map: NavMapState | null = useMemo(() => {
    if (!active) return null;
    const box = frameFor(leg?.geometry?.coordinates, current?.coord);
    return {
      position: fix ? { lon: fix.lon, lat: fix.lat } : null,
      heading: fix?.heading ?? 0,
      camera: null,
      // Le trajet a été retenu dans le panneau : il n'y a plus rien à comparer.
      choices: null,
      boldRoute: false,
      frame: box ? { bbox: box, token: `${journey?.id}:${index}` } : null,
    };
    // Le cadrage ne se refait qu'au changement d'action : le recalculer à
    // chaque battement d'horloge relancerait l'animation de la carte toutes les
    // secondes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index, journey?.id, fix]);

  return {
    active,
    journey,
    steps,
    index,
    current,
    upcoming: steps.slice(index + 1),
    stopsLeft,
    exit,
    connection: journey && current?.kind === "alight" ? connectionTo(steps, index, journey.legs) : null,
    offset,
    advance,
    back,
    simulating,
    toggleSimulation: useCallback(() => {
      simulatedRef.current = 0;
      setSimulating((value) => !value);
    }, []),
    start,
    stop,
    map,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** L'emprise du tronçon en cours, élargie de ce qu'il faut pour le voir entier. */
function frameFor(
  coordinates: GeoJSON.Position[] | undefined,
  point: LonLat | undefined
): [number, number, number, number] | null {
  if (coordinates?.length) {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lon, lat] of coordinates) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    return [west, south, east, north];
  }
  if (!point) return null;
  // Une action sans tracé — attendre sur un quai — se cadre sur un petit carré
  // autour d'elle : environ deux cents mètres de côté.
  const margin = 0.001;
  return [point.lon - margin, point.lat - margin, point.lon + margin, point.lat + margin];
}
