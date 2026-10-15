import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LonLat } from "../types";
import type { TransitJourney, TransitLine, TransitStop } from "../transport/journeyView";
import { bestExit, type StationExit } from "./exits";
import {
  buildTransitSteps,
  connectionTo,
  exitWanted,
  getOffTime,
  remainingStops,
  resyncStep,
  retimeLeg,
  scheduledStep,
  type ResyncMemory,
  type TransitStep,
} from "./transitSteps";
import {
  anchoredStep,
  boardingGate,
  linePosition,
  ridePosition,
  strayed,
  timeAtPosition,
  type Anchor,
  type GateMemory,
  type Hold,
} from "./transitGuide";
import { useNavPosition } from "./useNavPosition";
import { loadJourneys } from "../transport/journeys";
import { getNextDepartures } from "../services/transit";
import { note } from "./journal";
import { useLatest } from "../hooks/useLatest";
import { setJourneyStopHints } from "../services/idfm";
import type { NavMapState } from "./useNavigation";
import { useWakeLock } from "./useWakeLock";
import { askGetOffPermission, cancelGetOff, scheduleGetOff } from "./getOffAlert";
import { getOffAlertEnabled, useGetOffAlertEnabled } from "./settings";
import { navText } from "./strings";

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
//   3. **le premier train qui passe** : arrivé sur le quai, on monte dans le
//      premier qui part, pas forcément celui du calcul (14 octobre 2026 : le 9
//      d'avant pris, l'horaire avait trois minutes de retard sur le voyageur).
//      Ses horaires réels recalent toute la ligne (`retimeLeg`).
//
// Les deux flèches ne servent qu'à **regarder** les autres étapes (demande
// explicite, 15 octobre 2026) : elles ne déplacent plus la position. Revenu
// quatre étapes en arrière, le guidage plaçait le point bleu au Parc de
// Saint-Maur alors qu'on roulait dans Paris.
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
 * **Dans le train, la position est crue plus largement** (demande explicite,
 * 15 octobre 2026) : sous terre elle vient souvent de la 4G du tunnel, à
 * 100–300 m près, et le 14 octobre c'est elle qui avait raison contre
 * l'horaire. Les stations du métro étant à ~500 m, cela suffit à dire entre
 * lesquelles on roule — à condition que le relevé tombe sur la ligne.
 * shortcut: seuils estimés, pas mesurés — à reprendre sur un relevé réel sous terre.
 */
const RIDE_ACCURACY_METERS = 250;
const RIDE_FIX_MS = 60_000;

/** Écart à l'horaire, mesuré par la position, au-delà duquel la ligne est recalée. */
const RIDE_RETIME_MS = 30_000;

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
   * le point bleu de la liste (`ridePosition`). `null` : pas de point, on
   * regarde une autre étape.
   */
  rideFraction: number | null;
  /** La sortie à prendre en descendant, quand la station en déclare une. */
  exit: StationExit | null;
  /** À une descente sans sortie : la ligne à rejoindre par les couloirs. */
  connection: TransitLine | null;
  /** Étape regardée aux flèches, en nombre d'actions depuis celle où l'on est (0 : aucune). */
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
  /** Revient à l'étape où l'on est. */
  follow: () => void;
  simulating: boolean;
  toggleSimulation: () => void;
  start: (journey: TransitJourney) => void;
  stop: () => void;
  map: NavMapState | null;
}

export function useTransitNavigation(): TransitNavSession {
  const [journey, setJourney] = useState<TransitJourney | null>(null);
  // L'étape regardée aux flèches, `null` quand on suit celle où l'on est.
  const [viewing, setViewing] = useState<number | null>(null);
  // L'action où le GPS nous a reconnus (`anchoredStep`).
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [replanning, setReplanning] = useState(false);
  const [replannedAt, setReplannedAt] = useState(0);
  // Le dernier relevé est-il encore frais ? Remis à jour par l'horloge : un
  // relevé qui vieillit ne redessine rien de lui-même.
  const [fixFresh, setFixFresh] = useState(false);
  // Le même, avec la tolérance du trajet en train (`RIDE_FIX_MS`).
  const [rideFixFresh, setRideFixFresh] = useState(false);
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

  const navPosition = useNavPosition(active && !simulating);
  const fix = navPosition.fix;
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
      setRideFixFresh(!!latest && real - latest.at < RIDE_FIX_MS);
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
  const planned = steps.length ? clamp(based, 0, steps.length - 1) : 0;

  // Le relevé qui compte : frais et précis. Sous terre, il n'y en a pas, et
  // l'horaire reste seul maître.
  const here = useMemo(
    () => (fix && fixFresh && !simulating && fix.accuracy <= MAX_ACCURACY_METERS ? { lon: fix.lon, lat: fix.lat } : null),
    [fix, fixFresh, simulating],
  );
  // Dans le train : le relevé plus large, et la distance à la ligne qu'il tolère.
  const rideHere = useMemo(
    () =>
      fix && rideFixFresh && !simulating && fix.accuracy <= RIDE_ACCURACY_METERS
        ? { point: { lon: fix.lon, lat: fix.lat }, tolerance: Math.max(150, fix.accuracy) }
        : null,
    [fix, rideFixFresh, simulating],
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

  // `live` : l'action où l'on est ; `index` : celle qu'on montre, regardée aux flèches.
  const live = held && held.planned === planned ? held.index : planned;
  const browsing = viewing !== null && viewing !== live && viewing < steps.length;
  const index = browsing ? viewing : live;
  const hold = held && held.planned === planned && !browsing ? held.hold : null;
  const current = steps[index] ?? null;

  const indexRef = useRef(index);
  indexRef.current = index;
  const liveRef = useLatest(live);

  const look = useCallback(
    (target: number) => setViewing(target === liveRef.current ? null : target),
    [liveRef],
  );
  const advance = useCallback(() => look(Math.min(indexRef.current + 1, steps.length - 1)), [look, steps.length]);
  const back = useCallback(() => look(Math.max(indexRef.current - 1, 0)), [look]);
  const follow = useCallback(() => setViewing(null), []);

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
          setViewing(null);
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
    const step = steps[live];
    if (step) note("tc.step", { index: live, kind: step.kind, hold, horaire: scheduled, lieu: step.place });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hold, journey]);

  // Le premier train qui passe. Arrivé à l'étape « prendre la ligne », on
  // demande ses départs réels au quai (un appel par montée, sur le quota
  // partagé) et l'on suppose qu'on monte dans le premier après l'arrivée sur
  // le quai : l'heure prévue de cette arrivée, ou maintenant si l'on est en
  // avance. Toute la ligne glisse alors d'autant (`retimeLeg`).
  const retimedRef = useRef(new Set<string>());
  const liveStep = steps[live];
  const retimeKey =
    liveStep?.kind === "board" && journey && !simulating ? `${journey.id}:${liveStep.legIndex}` : null;
  useEffect(() => {
    const followed = journeyRef.current;
    const step = liveStep;
    if (!retimeKey || !followed || !step || retimedRef.current.has(retimeKey)) return;
    const leg = followed.legs[step.legIndex];
    if (!leg?.lineId || !leg.stopPointId) return;
    retimedRef.current.add(retimeKey);
    const controller = new AbortController();
    // `getNextDepartures` rend les départs strictement après cette heure.
    const onPlatform = new Date(Math.min(step.at.getTime(), Date.now()) - 1000);
    getNextDepartures(leg.lineId, leg.stopPointId, onPlatform, controller.signal)
      .then((departures) => {
        const first = departures[0]?.at;
        const latest = journeyRef.current;
        if (!first || !latest || latest.id !== followed.id) return;
        const planned = latest.legs[step.legIndex]?.departure;
        if (!planned || Math.abs(first.getTime() - planned.getTime()) < 30_000) return;
        note("tc.retime", { leg: step.legIndex, prevu: planned.toISOString(), pris: first.toISOString() });
        setJourney(retimeLeg(latest, step.legIndex, first));
        setNow(Date.now());
      })
      .catch((e: unknown) => {
        retimedRef.current.delete(retimeKey);
        note("tc.retime.error", { message: e instanceof Error ? e.message : String(e) });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retimeKey]);

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
    retimedRef.current.clear();
    // Dans le geste de « Démarrer » : la demande de permission s'y comprend.
    if (getOffAlertEnabled()) askGetOffPermission();
    setJourney(next);
    setViewing(null);
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
    cancelGetOff();
    setJourney(null);
    setViewing(null);
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
      liveRef.current,
      Date.now(),
      resyncRef.current
    );
    resyncRef.current = memory;
    if (target !== null) {
      // Une position reconnue, pas un décalage : voir `anchoredStep`.
      setAnchor({ index: target, scheduled: scheduledRef.current });
    }
    // Hors du chemin, plusieurs relevés de suite : le plan ne vaut plus.
    const stray = strayRef.current;
    if (strayed(steps, journey.legs, liveRef.current, { lon: fix.lon, lat: fix.lat })) {
      stray.count += 1;
      stray.since ||= Date.now();
      if (stray.count >= STRAY_FIXES && Date.now() - stray.since >= STRAY_MS) replan("strayed");
    } else {
      stray.count = 0;
      stray.since = 0;
    }
  }, [fix, active, steps, journey, replan, liveRef]);

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
  const stopsLeft = current?.kind === "alight" && !browsing ? remainingStops(leg, now) : null;
  // Les stations depuis celle où l'on est, et le point bleu entre elle et la
  // suivante. Sur le quai, on est à la première. Dedans : le GPS s'il répond,
  // sinon l'horaire — l'horloge redessine à chaque quart de tronçon (plus haut).
  // Une étape regardée aux flèches montre toute sa ligne, sans point bleu : on
  // n'y est pas.
  const onLine = current?.kind === "board" || current?.kind === "alight";
  const position =
    !onLine || browsing
      ? null
      : current?.kind === "board"
        ? 0
        : ridePosition(leg, now, rideHere?.point ?? null, rideHere?.tolerance);
  const rideFrom = position === null ? 0 : Math.min(Math.floor(position), (leg?.stops?.length ?? 1) - 1);
  const rideStops = useMemo(
    () => (!onLine ? NO_STOPS : (leg?.stops?.slice(rideFrom) ?? NO_STOPS)),
    [leg, rideFrom, onLine],
  );
  const rideFraction = position === null ? null : position - rideFrom;

  // **L'horaire se recale sur la position** : quand le relevé place le train
  // ailleurs que l'horaire, toute la ligne glisse de l'écart (`retimeLeg`).
  // Liste, arrêts restants, arrivée et alerte de descente suivent ; si la
  // position se tait ensuite, l'estimation repart de là. Une fois toutes les
  // trente secondes au plus.
  const ridingRetimeRef = useRef(0);
  useEffect(() => {
    const followed = journeyRef.current;
    const step = liveStep;
    if (!rideHere || !followed || step?.kind !== "alight") return;
    if (Date.now() - ridingRetimeRef.current < RIDE_RETIME_MS) return;
    const riding = followed.legs[step.legIndex];
    if (!riding) return;
    const at = linePosition(riding, rideHere.point, rideHere.tolerance);
    const expected = at === null ? null : timeAtPosition(riding, at);
    if (at === null || expected === null) return;
    const gap = Date.now() - expected;
    if (Math.abs(gap) < RIDE_RETIME_MS) return;
    ridingRetimeRef.current = Date.now();
    note("tc.retime", { leg: step.legIndex, position: Math.round(at * 10) / 10, ecart: Math.round(gap / 1000) });
    setJourney(retimeLeg(followed, step.legIndex, new Date(riding.departure.getTime() + gap)));
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideHere]);

  // L'alerte de descente (`getOffAlert.ts`) : quand le train quitte
  // l'avant-dernière station de la ligne où l'on est, d'après son horaire —
  // recalé sur le train pris. Programmée dès la montée, elle arrive écran
  // éteint (`getOffTime`).
  const alertOn = useGetOffAlertEnabled();
  const alertLegIndex = liveStep?.kind === "board" || liveStep?.kind === "alight" ? liveStep.legIndex : null;
  const alertLeg = alertLegIndex === null ? undefined : journey?.legs[alertLegIndex];
  const alertStops = alertLeg?.stops;
  const alertAt = alertLeg ? getOffTime(alertLeg) : null;
  const alertKey = alertLeg && journey ? `${journey.id}:${alertLegIndex}` : null;
  const alertExit = !browsing && current?.kind === "alight" ? exit : null;
  const alertBody = alertLeg
    ? [alertLeg.to ?? "", alertExit ? exitLabel(alertExit) : ""].filter(Boolean).join(" · ")
    : "";
  // Les lignes dont l'alerte est partie par le GPS : l'horaire ne la redonne pas.
  const firedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!alertOn || simulating || !alertKey || alertAt === null) {
      cancelGetOff();
      return;
    }
    // Déjà donnée par le GPS, ou passée depuis plus d'une minute : rien à refaire.
    if (firedRef.current.has(alertKey) || alertAt < Date.now() - 60_000) return;
    scheduleGetOff(Math.max(alertAt, Date.now()), navText("transit.getOffTitle"), alertBody);
    note("tc.getoff", { leg: alertLegIndex, at: new Date(alertAt).toISOString() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertOn, simulating, alertKey, alertAt, alertBody]);

  // Le GPS ne fait qu'**avancer** l'alerte : en surface (bus, tram, RER
  // aérien), application ouverte, passer l'avant-dernier arrêt plus tôt que
  // l'horaire la donne tout de suite. `ridePosition` ne dépasse l'horaire que
  // quand le relevé est sur la ligne.
  // shortcut: le GPS n'avance l'alerte que page ouverte ; dans la poche, seul l'horaire compte — un service de position serait la suite.
  useEffect(() => {
    if (!alertOn || simulating || !alertKey || alertAt === null || !here) return;
    if (liveStep?.kind !== "alight" || !alertStops || alertStops.length < 3) return;
    if (firedRef.current.has(alertKey) || Date.now() >= alertAt) return;
    const at = ridePosition(alertLeg, Date.now(), here);
    if (at === null || at < alertStops.length - 2) return;
    firedRef.current.add(alertKey);
    scheduleGetOff(Date.now(), navText("transit.getOffTitle"), alertBody);
    note("tc.getoff", { leg: alertLegIndex, gps: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here]);

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
    offset: index - live,
    hold,
    replanning,
    replanned: replannedAt !== 0,
    advance,
    back,
    follow,
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

function exitLabel(exit: StationExit): string {
  return exit.number ? navText("transit.exit", { number: exit.number, name: exit.name }) : navText("transit.exitUnnumbered", { name: exit.name });
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
