import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LonLat } from "../types";
import type { TransitJourney, TransitLine, TransitStop } from "../transport/journeyView";
import { bestExit, type StationExit } from "./exits";
import {
  buildTransitSteps,
  connectionTo,
  exitWanted,
  remainingStops,
  resyncStep,
  scheduledStep,
  type ResyncMemory,
  type TransitStep,
} from "./transitSteps";
import { anchoredStep, boardingGate, ridePosition, strayed, type Anchor, type GateMemory, type Hold } from "./transitGuide";
import { useNavPosition } from "./useNavPosition";
import { loadJourneys } from "../transport/journeys";
import { note } from "./journal";
import { useLatest } from "../hooks/useLatest";
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

/** Au-delà de cette incertitude, un relevé ne sert pas au recalage. */
const MAX_ACCURACY_METERS = 60;

/** Au-delà de cet âge, un relevé ne dit plus où l'on est : on est sans doute sous terre. */
const FRESH_FIX_MS = 20_000;

/**
 * Après l'heure du départ, le temps laissé avant de tenir le véhicule pour
 * manqué et de recalculer : deux minutes si l'on attend à l'arrêt (il peut
 * être en retard), une demi-minute si l'on marche encore (on ne l'aura pas).
 */
const MISSED_WAITING_MS = 120_000;
const MISSED_WALKING_MS = 30_000;

/** Hors du chemin : combien de relevés de suite, et depuis combien de temps, avant de recalculer. */
const STRAY_FIXES = 3;
const STRAY_MS = 20_000;

/** Pas plus d'un recalcul par minute : chaque calcul compte dans le quota de la source. */
const REPLAN_GAP_MS = 60_000;

/** Combien de temps le bandeau dit qu'il vient de recalculer. */
const REPLANNED_NOTE_MS = 20_000;

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
  /**
   * Les stations de la ligne en cours — celle qu'on attend ou celle où l'on
   * roule —, **depuis celle où l'on est**, la descente en dernier. Vide hors
   * d'une ligne, ou quand la source ne détaille pas la desserte.
   */
  rideStops: TransitStop[];
  /**
   * Où l'on est entre la première de ces stations et la suivante, de 0 à 1 :
   * le point bleu de la liste (`ridePosition`).
   */
  rideFraction: number;
  /** La sortie à prendre en descendant, quand la station en déclare une. */
  exit: StationExit | null;
  /** À une descente sans sortie : la ligne à rejoindre par les couloirs. */
  connection: TransitLine | null;
  /** Décalage manuel, en nombre d'actions, par rapport à l'horaire. */
  offset: number;
  /**
   * L'heure du départ est passée mais on n'est pas monté : on attend à l'arrêt
   * (`waiting`) ou l'on marche encore (`walking`). Voir `boardingGate`.
   */
  hold: Hold | null;
  /** Un nouveau trajet est en cours de calcul depuis la position. */
  replanning: boolean;
  /** Le trajet vient d'être recalculé : dit quelques secondes dans le bandeau. */
  replanned: boolean;
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
  // Le geste manuel (les deux flèches), en nombre d'actions.
  const [offset, setOffset] = useState(0);
  // L'action où le GPS nous a reconnus (`anchoredStep`).
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [replannedAt, setReplannedAt] = useState(0);
  // Le dernier relevé est-il encore frais ? Remis à jour par l'horloge : un
  // relevé qui vieillit ne redessine rien de lui-même.
  const [fixFresh, setFixFresh] = useState(false);
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
  const fixRef = useLatest(fix);
  const journeyRef = useLatest(journey);

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
      const latest = fixRef.current;
      setFixFresh(!!latest && real - latest.at < FRESH_FIX_MS);
      // L'horloge bat chaque seconde pour ne pas rater l'instant d'une action,
      // mais ne **redessine** que si elle change ce qu'on voit : l'action prévue
      // ou le nombre d'arrêts restants. Sinon, toute l'application se
      // redessinait chaque seconde pour rien.
      setNow((previous) =>
        scheduledStep(stepsRef.current, previous) === scheduledStep(stepsRef.current, next) &&
        remainingStops(legRef.current, previous) === remainingStops(legRef.current, next) &&
        // Le point bleu de la liste des stations : un quart de tronçon à la fois.
        Math.floor((ridePosition(legRef.current, previous, null) ?? 0) * 4) ===
          Math.floor((ridePosition(legRef.current, next, null) ?? 0) * 4)
          ? previous
          : next
      );
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, simulating, fixRef]);

  const scheduled = steps.length ? scheduledStep(steps, now) : 0;
  // Où l'horaire et le recalage nous placent, avant la porte de la montée.
  const based = anchoredStep(scheduled, anchor);
  const planned = steps.length ? clamp(based + offset, 0, steps.length - 1) : 0;

  // Le relevé qui compte : frais et précis. Sous terre, il n'y en a pas, et
  // l'horaire reste seul maître.
  const here = useMemo(
    () => (fix && fixFresh && !simulating && fix.accuracy <= MAX_ACCURACY_METERS ? { lon: fix.lon, lat: fix.lat } : null),
    [fix, fixFresh, simulating],
  );

  // La porte de la montée (`boardingGate`) : on n'est pas dans le véhicule
  // tant que le GPS nous voit sur le trottoir.
  const gateRef = useRef<GateMemory | null>(null);
  const [held, setHeld] = useState<{ planned: number; index: number; hold: Hold } | null>(null);
  const scheduledRef = useRef(scheduled);
  scheduledRef.current = scheduled;
  useEffect(() => {
    if (!journey || !steps.length) {
      setHeld(null);
      return;
    }
    const result = boardingGate(steps, journey.legs, planned, here, gateRef.current);
    gateRef.current = result.memory;
    if (result.index > planned) {
      // Monté avant l'horaire : c'est une position reconnue, comme un recalage.
      setAnchor({ index: result.index, scheduled: scheduledRef.current });
      setOffset(0);
    }
    const hold = result.hold;
    setHeld((previous) =>
      !hold
        ? null
        : previous && previous.planned === planned && previous.index === result.index && previous.hold === hold
          ? previous
          : { planned, index: result.index, hold },
    );
  }, [here, planned, journey, steps]);

  const index = held && held.planned === planned ? held.index : planned;
  const hold = held && held.planned === planned ? held.hold : null;
  const current = steps[index] ?? null;

  const indexRef = useRef(index);
  indexRef.current = index;
  const basedRef = useRef(based);
  basedRef.current = based;

  /**
   * Place le guidage sur une action précise, **à la main**. Le geste vaut
   * preuve : on dit qu'on est monté, la porte de la montée ne retient plus.
   */
  const goTo = useCallback(
    (target: number) => {
      const step = steps[target];
      if (step) gateRef.current = { leg: step.legIndex, reached: true, boarded: true };
      setOffset(target - basedRef.current);
    },
    [steps],
  );

  const advance = useCallback(() => goTo(Math.min(indexRef.current + 1, steps.length - 1)), [goTo, steps.length]);
  const back = useCallback(() => goTo(Math.max(indexRef.current - 1, 0)), [goTo]);

  // Là où mène le trajet : c'est vers lui qu'un recalcul repart.
  const destinationRef = useRef<LonLat | null>(null);
  const replanAfterRef = useRef(0);
  const replanAbortRef = useRef<AbortController | null>(null);

  /**
   * Recalcule le trajet **depuis la position** (demande explicite, 13 octobre
   * 2026 : « comme en voiture ») : véhicule manqué, ou chemin quitté. Silencieux
   * en cas d'échec — le trajet en cours reste. Pas de recalcul d'un parcours à
   * étapes : il repartirait droit vers l'arrivée en sautant les étapes voulues.
   */
  const replan = useCallback(
    (reason: "missed" | "strayed") => {
      const from = fixRef.current;
      const to = destinationRef.current;
      const followed = journeyRef.current;
      if (!from || !to || !followed || followed.stopoverAfter?.length) return;
      if (replanAbortRef.current || Date.now() < replanAfterRef.current) return;
      const controller = new AbortController();
      replanAbortRef.current = controller;
      setReplanning(true);
      note("tc.replan", { reason });
      loadJourneys([{ lon: from.lon, lat: from.lat }, to], controller.signal)
        .then((list) => {
          const next = list[0];
          if (!next || controller.signal.aborted) return;
          setJourney(next);
          setOffset(0);
          setAnchor(null);
          gateRef.current = null;
          setNow(Date.now());
          setReplannedAt(Date.now());
        })
        .catch((e: unknown) => {
          note("tc.replan.error", { message: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => {
          if (replanAbortRef.current !== controller) return;
          replanAbortRef.current = null;
          replanAfterRef.current = Date.now() + REPLAN_GAP_MS;
          setReplanning(false);
        });
    },
    [fixRef, journeyRef],
  );

  // Véhicule manqué : retenu par la porte au-delà de l'heure du départ.
  useEffect(() => {
    if (!held) return;
    const departed = steps[held.planned]?.at.getTime() ?? Date.now();
    const wait = held.hold === "waiting" ? MISSED_WAITING_MS : MISSED_WALKING_MS;
    const timer = window.setTimeout(() => replan("missed"), Math.max(0, departed + wait - Date.now()));
    return () => window.clearTimeout(timer);
  }, [held, steps, replan]);

  // L'annonce du recalcul s'efface d'elle-même.
  useEffect(() => {
    if (!replannedAt) return;
    const timer = window.setTimeout(() => setReplannedAt(0), REPLANNED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [replannedAt]);

  // Chaque changement d'action laisse une trace (`outils/journal.sh`) : le
  // 8 octobre 2026, rien ne permettait de dire pourquoi le guidage avait sauté.
  useEffect(() => {
    if (current) note("tc.step", { index, kind: current.kind, hold, horaire: scheduled, lieu: current.place });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, hold, journey]);

  const endReplan = useCallback(() => {
    replanAbortRef.current?.abort();
    replanAbortRef.current = null;
    replanAfterRef.current = 0;
    setReplanning(false);
    setReplannedAt(0);
    setAnchor(null);
    gateRef.current = null;
  }, []);

  const start = useCallback((next: TransitJourney) => {
    endReplan();
    const last = next.legs[next.legs.length - 1];
    const end = last?.stops?.[last.stops.length - 1] ?? null;
    const tail = last?.geometry?.coordinates?.[last.geometry.coordinates.length - 1];
    destinationRef.current = end ? { lon: end.lon, lat: end.lat } : tail ? { lon: tail[0], lat: tail[1] } : null;
    note("tc.start", { legs: next.legs.length, source: next.source });
    setJourney(next);
    setOffset(0);
    setSimulating(false);
    setExit(null);
    simulatedRef.current = 0;
    setNow(Date.now());
  }, [endReplan]);

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
    endReplan();
    note("tc.stop");
    setJourney(null);
    setOffset(0);
    setSimulating(false);
    setExit(null);
    simulatedRef.current = 0;
  }, [endReplan]);

  // Recalage par le GPS : voir `resyncStep` (`transitSteps.ts`). Près de
  // l'action en cours, un relevé suffit ; plus loin dans le trajet — on a pris
  // une autre ligne et l'on rejoint le plan en route —, il faut une preuve,
  // que `resyncRef` porte d'un relevé à l'autre. Un relevé trop imprécis ne
  // prouve rien : il est ignoré.
  const resyncRef = useRef<ResyncMemory | null>(null);
  const strayRef = useRef({ count: 0, since: 0 });
  useEffect(() => {
    resyncRef.current = null;
    strayRef.current = { count: 0, since: 0 };
  }, [journey]);
  useEffect(() => {
    if (!active || !fix || !steps.length || !journey) return;
    if (fix.accuracy > MAX_ACCURACY_METERS) return;
    const { index: target, memory } = resyncStep(
      steps,
      journey.legs,
      { lon: fix.lon, lat: fix.lat },
      indexRef.current,
      Date.now(),
      resyncRef.current
    );
    resyncRef.current = memory;
    if (target !== null) {
      // Une position reconnue, pas un décalage : voir `anchoredStep`.
      setAnchor({ index: target, scheduled: scheduledRef.current });
      setOffset(0);
    }
    // Hors du chemin, plusieurs relevés de suite : le plan ne vaut plus.
    const stray = strayRef.current;
    if (strayed(steps, journey.legs, indexRef.current, { lon: fix.lon, lat: fix.lat })) {
      stray.count += 1;
      stray.since ||= Date.now();
      if (stray.count >= STRAY_FIXES && Date.now() - stray.since >= STRAY_MS) replan("strayed");
    } else {
      stray.count = 0;
      stray.since = 0;
    }
  }, [fix, active, steps, journey, replan]);

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
  // Les stations depuis celle où l'on est, et le point bleu entre elle et la
  // suivante. Sur le quai, on est à la première. Dedans : le GPS s'il répond,
  // sinon l'horaire — l'horloge redessine à chaque quart de tronçon (plus haut).
  const riding = current?.kind === "alight";
  const position = current?.kind === "board" ? 0 : riding ? ridePosition(leg, now, here) : null;
  const rideFrom = position === null ? 0 : Math.min(Math.floor(position), (leg?.stops?.length ?? 1) - 1);
  const rideStops = useMemo(
    () => (position === null ? NO_STOPS : (leg?.stops?.slice(rideFrom) ?? NO_STOPS)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leg, rideFrom, position === null],
  );
  const rideFraction = position === null ? 0 : position - rideFrom;

  // Le cadrage : l'étape en cours, et non la position. Sous terre il n'y a pas
  // de position, et voir le tronçon qu'on parcourt vaut mieux qu'une carte
  // figée là où le signal s'est perdu.
  // Le sens de marche n'existe qu'en mouvement : à l'arrêt, sur un quai, la
  // flèche garde le dernier connu au lieu de pointer plein nord. Où l'on
  // regarde, c'est le cône de la boussole qui le dit.
  const lastHeadingRef = useRef(0);
  if (fix?.heading !== null && fix?.heading !== undefined && Number.isFinite(fix.heading)) {
    lastHeadingRef.current = fix.heading;
  }

  const map: NavMapState | null = useMemo(() => {
    if (!active) return null;
    const box = frameFor(leg?.geometry?.coordinates, current?.coord);
    return {
      position: fix ? { lon: fix.lon, lat: fix.lat } : null,
      heading: lastHeadingRef.current,
      camera: null,
      // Le trajet a été retenu dans le panneau : il n'y a plus rien à comparer.
      choices: null,
      boldRoute: false,
      compass: true,
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
    rideStops,
    rideFraction,
    exit,
    connection: journey && current?.kind === "alight" ? connectionTo(steps, index, journey.legs) : null,
    offset,
    hold,
    replanning,
    replanned: replannedAt !== 0,
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

const NO_STOPS: TransitStop[] = [];

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
