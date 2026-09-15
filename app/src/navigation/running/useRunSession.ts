import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LonLat } from "../../types";
import { reverseGeocode } from "../../services/geocode";
import { distance } from "../geo";
import { sampleElevationAlong } from "../elevation";
import { purgeTrips, saveTrip, type RunSample, type Trip } from "../history";
import { historyRetention, runSummaryEnabled } from "../settings";
import type { NavMapState } from "../useNavigation";
import { useNavPosition, type NavFix } from "../useNavPosition";
import { useWakeLock } from "../useWakeLock";
import { MAX_ACCURACY_M, MIN_RUN_MS, minStepFor, RUN_COLOR, RUN_ZOOM, SAMPLE_INTERVAL_MS } from "./run";

// ---------------------------------------------------------------------------
// La session de course : chronomètre, capture, pause, fin.
//
// **L'écran reste allumé pendant toute la course** (`useWakeLock`), et c'est
// délibéré : pas de service Android en arrière-plan. La position vient du même
// `watchPosition` que la navigation à pied ; si l'écran s'éteint malgré tout ou
// si l'on passe dans une autre application, la capture s'interrompt et reprend
// au retour — la distance ne compte alors que ce qui a été vu.
//
// **Le temps de course exclut les pauses** : l'allure et le graphe portent sur
// le temps passé à courir. Chaque reprise ouvre un nouveau tronçon (`s` dans
// les relevés), si bien qu'aucune allure n'est calculée à cheval sur une pause
// et que la distance ne saute pas entre l'endroit de la pause et celui de la
// reprise.
//
// **Moins de 45 secondes après le lancement, arrêter n'enregistre rien** et
// n'ouvre pas de résumé : c'est un départ lancé par erreur, pas une course.
// ---------------------------------------------------------------------------

export type RunStatus = "idle" | "running" | "paused";

export interface RunSession {
  active: boolean;
  status: RunStatus;
  fix: NavFix | null;
  error: string | null;
  /** Vrai tant que la carte suit le coureur. */
  follow: boolean;
  samples: RunSample[];
  distanceMeters: number;
  /** Temps couru avant la reprise en cours, pauses exclues, en millisecondes. */
  movingBaseMs: number;
  /**
   * Début de la reprise en cours. Le chronomètre y ajoute ce qui s'est écoulé
   * depuis, et **c'est le panneau qui le fait battre** (`RunPanel`) : une horloge
   * ici redessinait toute l'application chaque seconde.
   */
  resumedAt: number;
  /** La fiche de fin, ouverte après une course de 45 s au moins. */
  summary: Trip | null;
  /** L'état à passer à `MapView` : la position, la caméra et le tracé orange. */
  map: NavMapState | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  closeSummary: () => void;
  recenter: () => void;
  notifyPan: () => void;
}

export function useRunSession(): RunSession {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [summary, setSummary] = useState<Trip | null>(null);
  const [samples, setSamples] = useState<RunSample[]>([]);
  const [points, setPoints] = useState<LonLat[]>([]);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [follow, setFollow] = useState(true);
  const [heading, setHeading] = useState(0);
  // Le chronomètre se calcule au rendu du panneau : le temps déjà couru avant
  // la reprise en cours, plus ce qui s'est écoulé depuis (voir `RunPanel`).
  const [movingBaseMs, setMovingBaseMs] = useState(0);
  const [resumedAt, setResumedAt] = useState(0);

  // Les mêmes valeurs en refs, pour les rappels : ils sont lus au fil des
  // relevés GPS et au clic, et ne doivent pas dépendre du rendu en cours.
  const statusRef = useRef<RunStatus>("idle");
  const startedAtRef = useRef(0);
  const movingBaseRef = useRef(0);
  const resumedAtRef = useRef(0);
  const segmentRef = useRef(0);
  const lastCountedRef = useRef<LonLat | null>(null);
  const lastSampleAtRef = useRef(0);
  const distanceRef = useRef(0);
  const samplesRef = useRef<RunSample[]>([]);
  const pointsRef = useRef<LonLat[]>([]);
  const fromRef = useRef("");

  const setRunStatus = useCallback((next: RunStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const active = status !== "idle";
  // Le GPS reste allumé en pause : on veut continuer de se voir sur la carte.
  const position = useNavPosition(active);
  const fix = position.fix;
  // Le cap de la flèche : celui du dernier relevé en mouvement, gardé à l'arrêt
  // — un téléphone immobile annonce n'importe quel cap. Repris pendant le
  // rendu, relevé après relevé, plutôt que par un effet.
  if (status === "running" && fix && fix.heading !== null && (fix.speed ?? 0) > 1 && fix.heading !== heading) {
    setHeading(fix.heading);
  }
  useWakeLock(active);

  /** Temps de course à l'instant `at`, pauses exclues. */
  const movingMsAt = useCallback((at: number) => {
    const running = statusRef.current === "running" ? Math.max(0, at - resumedAtRef.current) : 0;
    return movingBaseRef.current + running;
  }, []);

  // Chaque relevé : on filtre, on espace, on compte.
  useEffect(() => {
    if (!fix || statusRef.current !== "running") return;
    if (fix.accuracy > MAX_ACCURACY_M) return;
    // Un relevé antérieur à la reprise date de la pause : il ne compte pas.
    if (fix.at < resumedAtRef.current) return;
    if (fix.at - lastSampleAtRef.current < SAMPLE_INTERVAL_MS) return;
    lastSampleAtRef.current = fix.at;

    const here = { lon: fix.lon, lat: fix.lat };
    const last = lastCountedRef.current;
    if (!last) {
      lastCountedRef.current = here;
      pointsRef.current = [...pointsRef.current, here];
      if (pointsRef.current.length === 1) nameStart(here);
    } else {
      const step = distance(last, here);
      // Le seuil se mesure depuis le dernier point **compté** : les petits
      // déplacements s'accumulent jusqu'à le franchir, rien ne se perd.
      if (step >= minStepFor(fix.accuracy)) {
        distanceRef.current += step;
        lastCountedRef.current = here;
        pointsRef.current = [...pointsRef.current, here];
      }
    }

    const sample: RunSample = {
      t: Math.round(movingMsAt(fix.at) / 100) / 10,
      d: Math.round(distanceRef.current * 10) / 10,
      v: fix.speed === null ? null : Math.round(fix.speed * 100) / 100,
      s: segmentRef.current,
    };
    samplesRef.current = [...samplesRef.current, sample];
    setSamples(samplesRef.current);
    setPoints(pointsRef.current);
    setDistanceMeters(distanceRef.current);

    function nameStart(point: LonLat) {
      const startedAt = startedAtRef.current;
      void reverseGeocode(point.lon, point.lat)
        .then((found) => {
          // Une autre course a pu démarrer entre-temps.
          if (startedAtRef.current === startedAt) fromRef.current = found?.address ?? found?.name ?? "";
        })
        .catch(() => {});
    }
  }, [fix, movingMsAt]);

  const start = useCallback(() => {
    const at = Date.now();
    startedAtRef.current = at;
    resumedAtRef.current = at;
    movingBaseRef.current = 0;
    segmentRef.current = 0;
    lastCountedRef.current = null;
    lastSampleAtRef.current = 0;
    distanceRef.current = 0;
    samplesRef.current = [];
    pointsRef.current = [];
    fromRef.current = "";
    setSamples([]);
    setPoints([]);
    setDistanceMeters(0);
    setSummary(null);
    setFollow(true);
    setMovingBaseMs(0);
    setResumedAt(at);
    setRunStatus("running");
  }, [setRunStatus]);

  const pause = useCallback(() => {
    if (statusRef.current !== "running") return;
    const at = Date.now();
    movingBaseRef.current += Math.max(0, at - resumedAtRef.current);
    lastCountedRef.current = null;
    setMovingBaseMs(movingBaseRef.current);
    setRunStatus("paused");
  }, [setRunStatus]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    const at = Date.now();
    resumedAtRef.current = at;
    segmentRef.current += 1;
    lastSampleAtRef.current = 0;
    setResumedAt(at);
    setRunStatus("running");
  }, [setRunStatus]);

  // Efface le tracé de la course close, une fois la fiche refermée ou sautée.
  const clearTrace = useCallback(() => {
    samplesRef.current = [];
    pointsRef.current = [];
    setSamples([]);
    setPoints([]);
    setDistanceMeters(0);
  }, []);

  const stop = useCallback(() => {
    if (statusRef.current === "idle") return;
    const endedAt = Date.now();
    const movingMs = movingMsAt(endedAt);
    setRunStatus("idle");

    // Un lancement par erreur : ni résumé, ni historique.
    if (endedAt - startedAtRef.current < MIN_RUN_MS) {
      clearTrace();
      return;
    }

    const trip: Trip = {
      id: `${endedAt}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "run",
      startedAt: startedAtRef.current,
      endedAt,
      from: fromRef.current,
      to: "",
      distanceMeters: distanceRef.current,
      elapsedSeconds: movingMs / 1000,
      pausedSeconds: Math.max(0, (endedAt - startedAtRef.current - movingMs) / 1000),
      announcedSeconds: 0,
      steps: 0,
      stepSource: "estimate",
      points: pointsRef.current,
      samples: samplesRef.current,
      profile: null,
      ascent: null,
      descent: null,
      completed: true,
    };
    // Fiche coupée dans la fenêtre « Modes » : la course s'enregistre de la
    // même façon, mais rien ne s'ouvre — ni maintenant, ni quand le profil
    // arrive.
    const showSummary = runSummaryEnabled();
    if (showSummary) setSummary(trip);
    else clearTrace();

    // Même règle que la marche : « ne rien enregistrer » vaut aussi ici.
    if (historyRetention() === "off") return;
    void purgeTrips()
      .catch(() => {})
      .then(() => saveTrip(trip))
      .then(() => addProfile(trip, showSummary ? setSummary : () => {}))
      .catch(() => {
        /* base indisponible : la fiche reste juste */
      });
  }, [clearTrace, movingMsAt, setRunStatus]);

  const closeSummary = useCallback(() => {
    setSummary(null);
    clearTrace();
  }, [clearTrace]);

  const recenter = useCallback(() => setFollow(true), []);
  const notifyPan = useCallback(() => setFollow(false), []);

  const map = useMemo<NavMapState | null>(() => {
    if (!active) return null;
    const here = fix ? { lon: fix.lon, lat: fix.lat } : null;
    return {
      position: here,
      heading,
      choices: null,
      boldRoute: false,
      // Carte au nord : en courant, une carte qui tourne à chaque virage fait
      // perdre ses repères. C'est la flèche qui pivote.
      camera: follow && here ? { center: here, bearing: 0, pitch: 0, zoom: RUN_ZOOM, paddingTop: 0 } : null,
      frame: null,
      trace: points.length > 1 ? { points, color: RUN_COLOR } : null,
    };
  }, [active, fix, heading, follow, points]);

  return {
    active,
    status,
    fix,
    error: position.error,
    follow,
    samples,
    distanceMeters,
    movingBaseMs,
    resumedAt,
    summary,
    map,
    start,
    pause,
    resume,
    stop,
    closeSummary,
    recenter,
    notifyPan,
  };
}

/**
 * Ajoute le dénivelé à la course, dans l'historique comme dans la fiche ouverte.
 * Même principe que la marche : la fiche s'ouvre sans l'attendre.
 */
async function addProfile(trip: Trip, publish: (update: (t: Trip | null) => Trip | null) => void) {
  if (trip.points.length < 2) return;
  const profile = await sampleElevationAlong(trip.points);
  const enriched: Trip = { ...trip, profile: profile.samples, ascent: profile.ascent, descent: profile.descent };
  await saveTrip(enriched);
  publish((current) => (current && current.id === trip.id ? enriched : current));
}
