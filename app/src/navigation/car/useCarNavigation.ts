import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LonLat, RouteResult } from "../../types";
import { distance } from "../geo";
import { useNavCameraMode } from "../settings";
import { navText } from "../strings";
import { useNavPosition, type NavFix } from "../useNavPosition";
import { useWakeLock } from "../useWakeLock";
import type { NavChoice, NavMapState } from "../useNavigation";
import { getCarRoutes, hasLiveEngine, type CarRoute } from "./carRoute";
import { CAR_OFF_ROUTE_FIXES, bearingAround, computeCarProgress, isOffRoute, pointAtMeters, type CarProgress } from "./carProgress";
import { rerouteRetryDelayMs, REROUTE_MIN_GAP_MS } from "../progress";
import { bubbleAnchors, getCarProposals, type CarProposal, type ProposalId } from "./proposals";
import { useSimulatedDriver } from "./carSimulate";
import { trafficOverlay, trafficSegments, type CarTraffic } from "./carTraffic";
import { note } from "../journal";
import { offlineTileStats } from "../../services/offline/nativeTiles";
import { NO_STREAK, nextWrongWay } from "./heading";
import { playRadarChime, radarAhead, radarsAlong, releaseRadarSound, type RouteRadar } from "./radars";
import { ARROW_BACKTRACK_METERS, CAMERA_DEAD_ZONE, NAV_PITCH, ZOOM_DEFAULT, paddingTop, zoomFor } from "./carCamera";
import { durationLabel, tollLabel } from "./carLabels";
import { HEADING_MAX_AGE_MS, HEADING_MIN_SPEED, useTravelHeading } from "./useTravelHeading";
import { useSpeedState, type SpeedState } from "./useSpeedState";
import { useLatest } from "../../hooks/useLatest";

// ---------------------------------------------------------------------------
// La session de navigation voiture.
//
// Elle ressemble à celle du piéton — un trajet, une position, un avancement, un
// recalcul — mais s'en sépare sur quatre points, et c'est ce qui justifie une
// session à part plutôt qu'un drapeau « mode voiture » dans l'autre :
//
// 1. **Elle commence par un choix.** Le guidage ne part pas du trajet affiché
//    dans le panneau : « Démarrer » ouvre trois propositions (sans péage, le
//    plus rapide, le moins cher), et c'est celle qu'on retient qui est calculée
//    en détail. Le piéton n'a rien à arbitrer.
// 2. **Le choix survit au recalcul.** Qui est parti sans péage ne doit pas se
//    retrouver sur l'autoroute parce qu'il a manqué une sortie : `avoidTolls`
//    est retenu et repassé à chaque recalcul.
// 3. **Elle surveille la vitesse**, ce qui n'a pas de sens à pied.
// 4. **Elle fait du bruit**, et c'est la seule de l'application : les radars,
//    et rien d'autre.
//
// Elles ne sont jamais actives ensemble, et partagent la forme que `MapView`
// attend (`NavMapState`).
// ---------------------------------------------------------------------------

/** Un relevé GPS résumé dans le journal au plus toutes les… (ms). */
const JOURNAL_GPS_MS = 5000;

/**
 * Cadence de la **réévaluation selon le trafic**, en millisecondes.
 *
 * Trois minutes. Chaque vérification coûte **deux** appels (voir plus bas) sur
 * un palier de 20 000 par mois : quarante par heure, soit cent soixante pour un
 * trajet de quatre heures, et de quoi rouler environ cent vingt-cinq heures par
 * mois. C'est large pour un usage personnel, et c'est la cadence qui décide du
 * délai maximal avant de voir un bouchon se former devant.
 */
const TRAFFIC_CHECK_MS = 3 * 60 * 1000;

/**
 * Gain minimal, en secondes, pour changer d'itinéraire en cours de route.
 *
 * **Deux minutes.** Le seuil ne sert plus à compenser une mesure incertaine —
 * depuis que les deux parcours sont chiffrés au même instant, le bruit est
 * mesuré à **quatorze secondes** (cinq réévaluations d'affilée sur un
 * Paris → Lyon inchangé : 0,22 à 0,23 minute d'écart, d'une stabilité
 * remarquable). Il pourrait donc descendre bien plus bas sans jamais faire
 * changer de route pour du vent.
 *
 * S'il reste à deux minutes, c'est pour une raison d'usage et non de mesure :
 * dérouter quelqu'un pour lui faire gagner quatre-vingt-dix secondes sur une
 * heure de route, c'est lui imposer un chemin qu'il ne connaît pas contre un
 * gain qu'il ne sentira pas. Un ralentissement de cinq minutes dont un détour
 * rattrape la moitié franchit ce seuil sans difficulté.
 *
 * C'est **le réglage à toucher** si les changements paraissent trop rares ou
 * trop fréquents ; le plancher mesuré est d'une vingtaine de secondes.
 */
const TRAFFIC_GAIN_SECONDS = 120;

/**
 * Seuil de déviation employé pour **épingler** notre propre parcours.
 *
 * Passé au moteur avec les points d'appui, il lui interdit en pratique de
 * s'écarter : il rend alors le trajet qu'on suit, **ré-horodaté avec le trafic
 * du moment**. C'est la mesure qui manquait — sans elle on ne sait pas combien
 * de temps notre plan prend vraiment maintenant, seulement combien il prenait
 * quand on l'a calculé.
 */
const PIN_GAIN_SECONDS = 100_000;

/**
 * Dérive minimale, en secondes, pour corriger l'heure d'arrivée affichée.
 *
 * En dessous de deux minutes, l'écart relève du bruit de mesure du moteur et
 * non d'un embouteillage : le corriger ferait danser l'heure d'arrivée sans
 * rien apprendre.
 */
const ETA_DRIFT_SECONDS = 120;

export type CarNavStatus = "idle" | "choosing" | "computing" | "running" | "arrived" | "error";

/** Un radar annoncé, tant qu'on ne l'a pas dépassé. */
export interface RadarAlert {
  radar: RouteRadar;
  distanceMeters: number;
}

export interface CarNavSession {
  active: boolean;
  status: CarNavStatus;
  /** Les propositions, tant que l'écran de choix est ouvert. */
  proposals: CarProposal[] | null;
  /**
   * L'instant auquel les propositions ont été calculées.
   *
   * C'est **lui** qui sert à écrire l'heure d'arrivée de chacune, et non
   * l'instant du rendu : les durées annoncées valent pour l'état du trafic à ce
   * moment-là, et les rattacher à l'horloge courante ferait glisser l'heure
   * d'arrivée pendant qu'on lit l'écran, sans que rien ne l'ait justifié.
   */
  proposalsAt: number | null;
  /** La proposition retenue, une fois le guidage parti. */
  chosen: CarProposal | null;
  route: CarRoute | null;
  progress: CarProgress | null;
  speed: SpeedState;
  alert: RadarAlert | null;
  error: string | null;
  rerouting: boolean;
  /**
   * Le temps gagné par le dernier changement d'itinéraire dû au trafic, tant
   * que le bandeau l'annonce. `null` le reste du temps.
   */
  trafficGainSeconds: number | null;
  /**
   * Le temps restant et l'heure d'arrivée, **corrigés du trafic constaté depuis
   * le calcul du trajet**.
   *
   * `progress.remainingSeconds` se déduit des durées figées au calcul : un
   * bouchon qui se forme devant ne l'allonge pas. La réévaluation périodique
   * mesure l'écart et il est ajouté ici. C'est cette valeur-là que le panneau
   * affiche — jamais celle de `progress` directement.
   */
  eta: { remainingSeconds: number; arrivalAt: Date } | null;
  follow: boolean;
  destinationName: string | null;
  mapRoute: RouteResult | null;
  map: NavMapState | null;
  /** Ouvre l'écran de choix et lance le calcul des propositions. */
  choose: (points: LonLat[], names?: { to?: string | null }) => void;
  /** Retient une proposition et démarre le guidage. */
  start: (id: ProposalId) => void;
  stop: () => void;
  recenter: () => void;
  notifyPan: () => void;
  simulating: boolean;
  toggleSimulation: () => void;
}

interface Request {
  points: LonLat[];
  avoidTolls: boolean;
  reroute: boolean;
  /** Le sens où l'on roule, pour que le moteur parte de ce côté (`CarRouteOptions.heading`). */
  heading: number | null;
}

/** Aucun radar : une seule liste vide, pour ne pas en fabriquer une par rendu. */
const NO_RADARS: RouteRadar[] = [];

/** La mémoire de la flèche et de la caméra, d'un relevé au suivant. */
interface CarPose {
  fix: NavFix | null;
  progress: CarProgress | null;
  route: CarRoute | null;
  arrow: { route: CarRoute; meters: number } | null;
  center: LonLat | null;
}

const NO_POSE: CarPose = { fix: null, progress: null, route: null, arrow: null, center: null };

export function useCarNavigation(): CarNavSession {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<CarNavStatus>("idle");
  const [proposals, setProposals] = useState<CarProposal[] | null>(null);
  const [proposalsAt, setProposalsAt] = useState<number | null>(null);
  const [chosen, setChosen] = useState<CarProposal | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [route, setRoute] = useState<CarRoute | null>(null);
  const [progress, setProgress] = useState<CarProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // La dernière requête qui a abouti ou échoué : un recalcul est en cours tant
  // que la requête courante n'y est pas.
  const [settledRequest, setSettledRequest] = useState<Request | null>(null);
  const rerouting = request?.reroute === true && settledRequest !== request;
  const [follow, setFollow] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [destinationName, setDestinationName] = useState<string | null>(null);
  // Les radars, rangés avec le parcours où ils ont été relevés.
  const [radarsFor, setRadarsFor] = useState<{ route: CarRoute; radars: RouteRadar[] } | null>(null);
  const radars = route && radarsFor?.route === route ? radarsFor.radars : NO_RADARS;
  const [alert, setAlert] = useState<RadarAlert | null>(null);
  const [trafficGainSeconds, setTrafficGainSeconds] = useState<number | null>(null);
  // De combien le trafic constaté allonge (ou raccourcit) le trajet par rapport
  // à ce qu'annonçait son calcul. Remis à zéro à chaque nouveau trajet.
  const [etaDriftSeconds, setEtaDriftSeconds] = useState(0);
  // Le trafic sur le parcours suivi : celui du calcul, puis celui de chaque
  // réévaluation.
  // Le trafic du parcours suivi : celui de son calcul, remplacé à chaque
  // réévaluation par celui du parcours épinglé. Rangé avec le trajet auquel il
  // se rapporte : un nouveau parcours — départ, recalcul, meilleur trajet
  // adopté — repart de son propre trafic, sans effet qui le remette.
  const [pinnedTraffic, setPinnedTraffic] = useState<{ route: CarRoute; traffic: CarTraffic } | null>(null);
  const routeTraffic = useMemo(() => (route ? trafficOverlay(route) : null), [route]);
  const liveTraffic = route && pinnedTraffic?.route === route ? pinnedTraffic.traffic : routeTraffic;
  // La proposition sous le doigt, tant qu'on n'a pas tranché. Elle n'engage
  // rien : elle décide seulement laquelle est tracée en plein et laquelle
  // s'efface, pour qu'on puisse comparer deux parcours du regard avant de
  // toucher la bulle qui part.
  const [highlighted, setHighlighted] = useState<ProposalId | null>(null);

  // Les points encore à atteindre : un recalcul repart de là, jamais du départ.
  const targetsRef = useRef<LonLat[]>([]);
  // Le choix de péage, retenu pour tous les recalculs de la session.
  const avoidTollsRef = useRef(false);
  const indexRef = useRef(0);
  const offRouteRef = useRef(0);
  const reroutingRef = useLatest(rerouting);
  // Recalculs ratés d'affilée, et l'instant avant lequel on n'en retente pas
  // (`rerouteRetryDelayMs`) : hors réseau ou refusé par TomTom (429), un
  // recalcul repartait sinon tous les deux relevés.
  const rerouteFailuresRef = useRef(0);
  const rerouteRetryAtRef = useRef(0);
  // Plancher entre deux recalculs **réussis** (`REROUTE_MIN_GAP_MS`). Il ne vaut
  // que pour l'écart au parcours : le contresens, lui, doit répondre tout de
  // suite — c'est précisément ce pour quoi il existe.
  const rerouteGapUntilRef = useRef(0);
  // Le rang du radar à partir duquel chercher, et le dernier annoncé : le son
  // ne doit retentir qu'une fois par radar, même si le relevé recule d'un mètre.
  const radarFromRef = useRef(0);
  const announcedRef = useRef(-1);
  // Où en est la flèche sur le tracé — elle ne recule pas au gré du GPS — et le
  // dernier centre de la caméra, que la zone morte garde tant qu'on n'a pas
  // vraiment avancé. Mis à jour une fois par relevé (voir `map`).
  const [pose, setPose] = useState<CarPose>(NO_POSE);
  // Relevés consécutifs à contresens, et l'avancement sur le tracé au premier.
  const wrongWayRef = useRef(NO_STREAK);
  // Le dernier relevé GPS noté au journal.
  const journalGpsRef = useRef(0);

  // Le trajet et l'avancement, relus par la réévaluation périodique : elle est
  // réveillée par une horloge et non par un rendu, elle ne peut donc pas
  // dépendre de la fermeture d'un effet.
  const routeRef = useLatest(route);
  const progressRef = useLatest(progress);

  const cameraMode = useNavCameraMode();
  const running = active && status !== "choosing";
  // Le suivi démarre **dès l'écran de choix**, et non au départ : la position et
  // le sens de marche doivent être connus au moment où l'on touche la bulle,
  // sans quoi le premier calcul part d'une position périmée et sans direction.
  const live = useNavPosition(active && !simulating);
  const simulated = useSimulatedDriver(route, running && simulating);
  const fix = simulating ? simulated : live.fix;
  // Le dernier relevé, pour le départ et la réévaluation, réveillés hors rendu.
  const fixRef = useLatest(fix);
  // Le sens de marche (`useTravelHeading.ts`).
  const travelHeading = useTravelHeading(fix);

  // Le compteur (`useSpeedState.ts`).
  const speed = useSpeedState(fix, route, progress, running);
  // Au volant plus qu'ailleurs : un écran éteint, et il n'y a plus de guidage.
  useWakeLock(running);

  /** Ouvre l'écran de choix : deux appels au moteur, rien n'est encore engagé. */
  const choose = useCallback((points: LonLat[], names?: { to?: string | null }) => {
    if (points.length < 2) return;
    setActive(true);
    setStatus("choosing");
    setProposals(null);
    setProposalsAt(null);
    setChosen(null);
    setRoute(null);
    setProgress(null);
    setError(null);
    setAlert(null);
    setTrafficGainSeconds(null);
    setEtaDriftSeconds(0);
    setHighlighted(null);
    setFollow(true);
    setSimulating(false);
    setDestinationName(names?.to ?? null);
    targetsRef.current = points.slice(1);
    note("car.choose", { stops: points.length - 1 });
    indexRef.current = 0;
    offRouteRef.current = 0;
    radarFromRef.current = 0;
    announcedRef.current = -1;

    const controller = new AbortController();
    getCarProposals(points, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        if (!found.length) throw new Error(navText("car.errorNoRoute"));
        setProposals(found);
        note("car.proposals", {
          count: found.length,
          minutes: found.map((p) => Math.round(p.route.durationSeconds / 60)),
        });
        setProposalsAt(Date.now());
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : navText("car.errorNoRoute"));
      });
  }, []);

  /**
   * Retient une proposition et demande le trajet détaillé.
   *
   * Le parcours est **recalculé** plutôt que repris de la proposition : celle-ci
   * a été demandée sans les manœuvres, sans les voies et sans les vitesses, qui
   * pèsent cinq fois le reste et n'avaient pas à être téléchargées pour trois
   * itinéraires dont deux seraient écartés.
   */
  const start = useCallback(
    (id: ProposalId) => {
      const proposal = proposals?.find((p) => p.id === id);
      if (!proposal) return;
      setChosen(proposal);
      setStatus("computing");
      // La carte a pu être déplacée pendant qu'on comparait les parcours : le
      // guidage reprend la main dessus, sans quoi il faudrait appuyer sur
      // « Recentrer » juste après être parti.
      setFollow(true);
      // Qui part sans péage ne doit pas y être ramené par le premier recalcul :
      // le choix vaut pour toute la session, pas pour le premier tracé.
      avoidTollsRef.current = id === "free";
      // Depuis là où l'on est **au moment de partir**, pas depuis l'écran de
      // choix : on a pu avancer entre-temps. La proposition ne sert de départ
      // que si aucun relevé récent n'existe.
      const here = fixRef.current;
      const fresh = here !== null && Date.now() - here.at < HEADING_MAX_AGE_MS;
      const heading = travelHeading();
      note("car.start", { proposal: id, heading, fromFix: fresh, accuracy: here?.accuracy });
      setRequest({
        points: [fresh ? { lon: here.lon, lat: here.lat } : proposal.route.points[0], ...targetsRef.current],
        avoidTolls: avoidTollsRef.current,
        reroute: false,
        heading,
      });
    },
    [proposals, travelHeading, fixRef]
  );

  const stop = useCallback(() => {
    note("car.stop", { tiles: { ...offlineTileStats } });
    setActive(false);
    setStatus("idle");
    setProposals(null);
    setProposalsAt(null);
    setChosen(null);
    setRequest(null);
    setRoute(null);
    setProgress(null);
    setError(null);
    setAlert(null);
    setTrafficGainSeconds(null);
    setEtaDriftSeconds(0);
    setSimulating(false);
    releaseRadarSound();
  }, []);

  // Le calcul, au départ comme après un écart.
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    let cancelled = false;
    if (!request.reroute) rerouteFailuresRef.current = rerouteRetryAtRef.current = 0;
    note(request.reroute ? "car.reroute.compute" : "car.route.compute", { heading: request.heading });

    getCarRoutes(request.points, {
      avoidTolls: request.avoidTolls,
      guidance: true,
      heading: request.heading,
      signal: controller.signal,
    })
      .then(([next]) => {
        if (cancelled || !next) return;
        note("car.route", {
          reroute: request.reroute,
          km: next.distanceMeters / 1000,
          minutes: next.durationSeconds / 60,
          live: next.live,
          traffic: next.traffic.length,
        });
        setRoute(next);
        setProgress(null);
        setStatus("running");
        setError(null);
        // La durée du nouveau trajet vient d'être calculée : elle est à jour,
        // et la dérive accumulée sur le précédent n'a plus d'objet.
        setEtaDriftSeconds(0);
        indexRef.current = 0;
        offRouteRef.current = 0;
        rerouteFailuresRef.current = rerouteRetryAtRef.current = 0;
        rerouteGapUntilRef.current = request.reroute ? Date.now() + REROUTE_MIN_GAP_MS : 0;
        wrongWayRef.current = NO_STREAK;
        radarFromRef.current = 0;
        announcedRef.current = -1;
        setAlert(null);
      })
      .catch((e: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        // Un premier calcul raté arrête tout ; un recalcul raté laisse en place
        // le trajet précédent — perdre le guidage parce qu'une requête a manqué
        // serait le pire moment, surtout au volant.
        if (request.reroute) {
          rerouteFailuresRef.current += 1;
          rerouteRetryAtRef.current = Date.now() + rerouteRetryDelayMs(rerouteFailuresRef.current);
        }
        note("car.route.error", {
          reroute: request.reroute,
          message: e instanceof Error ? e.message : String(e),
          retrySeconds: request.reroute ? rerouteRetryDelayMs(rerouteFailuresRef.current) / 1000 : undefined,
        });
        if (!request.reroute) setStatus("error");
        setError(e instanceof Error ? e.message : navText("car.errorNoRoute"));
      })
      .finally(() => {
        if (!cancelled) setSettledRequest(request);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [request]);

  /**
   * Les radars du parcours, relevés une fois par trajet.
   *
   * C'est un import dynamique et trois mille projections : le faire à chaque
   * relevé serait absurde, et le faire d'avance pour les trois propositions le
   * serait tout autant — on n'en suit qu'une.
   */
  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    radarsAlong(route)
      .then((found) => {
        if (!cancelled) setRadarsFor({ route, radars: found });
      })
      .catch(() => {
        // Jeu de données indisponible : le guidage continue, simplement sans
        // avertissement. Rien à dire à l'utilisateur — il n'y a pas de réglage
        // à corriger de son côté.
      });
    return () => {
      cancelled = true;
    };
  }, [route]);

  // L'avancement, à chaque relevé.
  useEffect(() => {
    if (!route || !fix || !active) return;
    const next = computeCarProgress(route, fix, indexRef.current);
    indexRef.current = next.index;
    setProgress(next);
    if (fix.at - journalGpsRef.current >= JOURNAL_GPS_MS) {
      journalGpsRef.current = fix.at;
      note("gps", {
        acc: fix.accuracy,
        kmh: fix.speed === null ? null : fix.speed * 3.6,
        cap: fix.heading,
        ecart: next.offsetMeters,
        fait: next.traveledMeters,
        reste: next.remainingMeters,
      });
    }

    if (next.arrived) {
      note("car.arrived", { fait: next.traveledMeters });
      setStatus("arrived");
      offRouteRef.current = 0;
      setAlert(null);
      return;
    }
    if (status === "error") setStatus("running");

    // --- les radars ------------------------------------------------------
    const ahead = radarAhead(radars, next.traveledMeters, radarFromRef.current);
    if (ahead) {
      radarFromRef.current = ahead.index;
      setAlert({ radar: ahead.radar, distanceMeters: ahead.distanceMeters });
      // Le son, une seule fois par radar : c'est un avertissement, pas une
      // alarme qu'on répète jusqu'à ce qu'elle soit acquittée.
      if (announcedRef.current !== ahead.index) {
        announcedRef.current = ahead.index;
        playRadarChime();
      }
    } else {
      setAlert((current) => (current === null ? current : null));
      // La liste étant triée, on avance le point de départ de la recherche
      // au-delà de ce qui est derrière nous.
      while (
        radarFromRef.current < radars.length &&
        radars[radarFromRef.current].atMeters < next.traveledMeters - 50
      ) {
        radarFromRef.current += 1;
      }
    }

    // --- le recalcul -----------------------------------------------------
    const reroute = (reason: "offRoute" | "wrongWay") => {
      note("car.reroute", { reason, ecart: next.offsetMeters, cap: travelHeading(), fait: next.traveledMeters });
      offRouteRef.current = 0;
      wrongWayRef.current = NO_STREAK;
      const remaining = targetsAhead(route, next, targetsRef.current);
      targetsRef.current = remaining;
      setRequest({
        points: [{ lon: fix.lon, lat: fix.lat }, ...remaining],
        avoidTolls: avoidTollsRef.current,
        reroute: true,
        // Le sens où l'on roule : sans lui, le moteur repart volontiers par un
        // demi-tour vers l'endroit qu'on vient de manquer.
        heading: travelHeading(),
      });
    };

    // À contresens sur le tracé, on n'attend pas d'en être à cinquante mètres.
    // Au départ surtout, le moteur a pu choisir l'autre sens de la rue : le
    // constater au cap plutôt qu'à l'écart évite d'enchaîner les recalculs
    // (constaté : quarante-cinq secondes pour comprendre qu'on partait à
    // droite, chaque recalcul redessinant la route derrière soi).
    // La règle elle-même est dans `heading.ts`, en fonction pure et testée.
    const wrongWay = nextWrongWay(wrongWayRef.current, {
      gpsHeading: fix.heading !== null && (fix.speed ?? 0) > HEADING_MIN_SPEED ? fix.heading : null,
      routeBearing: bearingAround(route, next.traveledMeters),
      traveledMeters: next.traveledMeters,
      offRoute: isOffRoute(next),
    });
    wrongWayRef.current = wrongWay.streak;
    const retryAllowed = Date.now() >= rerouteRetryAtRef.current;
    if (wrongWay.reroute && !reroutingRef.current && retryAllowed) {
      reroute("wrongWay");
      return;
    }

    if (isOffRoute(next)) {
      offRouteRef.current += 1;
      // Le plancher entre deux recalculs réussis ne s'applique qu'ici : un
      // conducteur qui s'écarte peut attendre trente secondes, le trajet
      // précédent restant affiché — celui qui roule à contresens, non.
      const gapPassed = Date.now() >= rerouteGapUntilRef.current;
      if (offRouteRef.current >= CAR_OFF_ROUTE_FIXES && !reroutingRef.current && retryAllowed && gapPassed) {
        reroute("offRoute");
      }
    } else {
      offRouteRef.current = 0;
    }
  }, [fix, route, active, radars, status, travelHeading, reroutingRef]);

  /**
   * La réévaluation selon le trafic — la deuxième demande faite à ce chantier.
   *
   * Elle se distingue du recalcul en ce qu'elle n'attend **aucune erreur de
   * notre part** : on suit son parcours, tout va bien, et c'est la route devant
   * qui se bouche.
   *
   * ## Deux appels, et pourquoi il en faut deux
   *
   * Toutes les trois minutes, on demande **deux** choses au moteur :
   *
   * 1. notre parcours **épinglé** (points d'appui + `PIN_GAIN_SECONDS`), qui
   *    revient ré-horodaté avec le trafic du moment : c'est le temps que notre
   *    plan prend *vraiment* maintenant ;
   * 2. le **meilleur parcours** depuis l'endroit où l'on est, sans contrainte.
   *
   * On n'adopte le second que s'il gagne `TRAFFIC_GAIN_SECONDS` sur le premier.
   *
   * Une version précédente n'appelait qu'une fois et comparait le parcours rendu
   * à `progress.remainingSeconds` — **et c'était faux**, d'une façon qui tuait
   * précisément le cas qu'on veut traiter. Ce temps restant se déduit des durées
   * figées au calcul du trajet : un bouchon qui se forme devant ne l'allonge
   * jamais. On comparait donc un détour chiffré au trafic d'aujourd'hui contre
   * un trajet chiffré au trafic d'il y a une heure, et le détour perdait
   * toujours. Comparer deux mesures fraîches est la seule façon correcte.
   *
   * L'écart entre le parcours épinglé et ce que nous annoncions donne en prime
   * la **dérive de l'heure d'arrivée** : même quand on ne change pas de route,
   * on sait enfin qu'on arrivera vingt minutes plus tard que prévu.
   *
   * Trois garde-fous : rien tant qu'on n'est pas en route, rien pendant un
   * recalcul en cours, et un échec est **silencieux** — le trajet en cours reste
   * en place, il n'y a rien à dire à quelqu'un qui conduit.
   */
  useEffect(() => {
    if (!active || status !== "running" || !hasLiveEngine()) return;
    const controller = new AbortController();

    const timer = window.setInterval(() => {
      const current = routeRef.current;
      const where = progressRef.current;
      // Hors du parcours, c'est au recalcul de répondre : réévaluer depuis le
      // tracé qu'on vient de quitter pourrait adopter un trajet qui repart de
      // la sortie manquée.
      if (!current || !where || reroutingRef.current || isOffRoute(where)) return;
      // Le parcours qui reste : c'est lui qu'on soumet à réévaluation, pas
      // celui qu'on a déjà fait.
      const ahead = current.points.slice(where.index);
      if (ahead.length < 2) return;

      // Depuis la **vraie** position, pas son projeté sur le tracé : le meilleur
      // trajet se calcule d'où l'on est. Le projeté ne sert que faute de relevé.
      const here = fixRef.current;
      const from = here ? { lon: here.lon, lat: here.lat } : { lon: where.snapped.lon, lat: where.snapped.lat };
      const points = [from, ...targetsRef.current];
      const heading = travelHeading();

      void Promise.all([
        // Notre plan, ré-horodaté : léger, il n'a besoin ni des manœuvres ni
        // des voies puisqu'on ne le suivra pas différemment.
        getCarRoutes(points, {
          avoidTolls: avoidTollsRef.current,
          // Le premier appui est la position elle-même : le parcours épinglé
          // part bien d'où l'on est, et rejoint le tracé qu'on suit.
          following: [from, ...ahead],
          minGainSeconds: PIN_GAIN_SECONDS,
          heading,
          signal: controller.signal,
        }),
        // Le meilleur d'aujourd'hui, celui-là avec tout ce qu'il faut pour être
        // suivi s'il l'emporte.
        getCarRoutes(points, {
          avoidTolls: avoidTollsRef.current,
          guidance: true,
          heading,
          signal: controller.signal,
        }),
      ])
        .then(([[pinned], [candidate]]) => {
          if (controller.signal.aborted || !pinned || !candidate) return;

          const gain = pinned.durationSeconds - candidate.durationSeconds;
          note("car.reevaluate", { gain, adopted: gain >= TRAFFIC_GAIN_SECONDS, traffic: pinned.traffic.length });
          if (gain >= TRAFFIC_GAIN_SECONDS) {
            setRoute(candidate);
            setProgress(null);
            indexRef.current = 0;
            offRouteRef.current = 0;
            radarFromRef.current = 0;
            announcedRef.current = -1;
            setAlert(null);
            setEtaDriftSeconds(0);
            setTrafficGainSeconds(Math.round(gain));
            return;
          }

          // On garde la route, mais on sait désormais ce qu'elle coûte
          // réellement : l'heure d'arrivée cesse de mentir.
          const drift = pinned.durationSeconds - where.remainingSeconds;
          if (Math.abs(drift) >= ETA_DRIFT_SECONDS) setEtaDriftSeconds(Math.round(drift));
          // Et ce qui ralentit devant : le parcours épinglé revient avec le
          // trafic du moment, depuis l'endroit où l'on est.
          setPinnedTraffic({ route: current, traffic: trafficOverlay(pinned) });
        })
        .catch((e: unknown) => {
          note("car.reevaluate.error", { message: e instanceof Error ? e.message : String(e) });
          // Réseau, quota, service : on garde le trajet en cours. Un guidage
          // qui signale ses échecs de fond au conducteur ne l'aide en rien.
        });
    }, TRAFFIC_CHECK_MS);

    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [active, status, travelHeading, progressRef, reroutingRef, routeRef, fixRef]);

  // L'annonce du changement s'efface d'elle-même : elle rend compte d'un fait
  // passé, et n'a rien à faire dans le bandeau une fois qu'on l'a lue.
  useEffect(() => {
    if (trafficGainSeconds === null) return;
    const timer = window.setTimeout(() => setTrafficGainSeconds(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [trafficGainSeconds]);

  // L'erreur de position est lue telle que le suivi la rend (voir le retour) ;
  // ici, on ne fait que la noter au journal.
  useEffect(() => {
    if (live.error && !simulating) note("gps.error", { message: live.error });
  }, [live.error, simulating]);

  /**
   * Le temps restant et l'heure d'arrivée, dérive du trafic comprise.
   *
   * C'est ce que le panneau affiche. `progress.remainingSeconds` ne suffit pas :
   * il ignore tout ce qui s'est bouché depuis le calcul du trajet.
   */
  const eta = useMemo(() => {
    if (!progress || !fix) return null;
    const remainingSeconds = Math.max(0, progress.remainingSeconds + etaDriftSeconds);
    // À partir de l'heure du relevé, qui est l'instant que décrit l'avancement —
    // et non de l'horloge au moment du rendu.
    return { remainingSeconds, arrivalAt: new Date(fix.at + remainingSeconds * 1000) };
  }, [progress, fix, etaDriftSeconds]);

  /**
   * Les propositions telles que la carte les dessine : un tracé chacune, et une
   * bulle posée là où ce parcours s'écarte le plus des autres.
   *
   * La bulle porte **la durée puis le péage**, et rien de plus. Pas de libellé
   * « sans péage » au-dessus d'un « aucun péage » — dire deux fois la même
   * chose dans une bulle de deux lignes, c'est n'en dire qu'une et gâcher
   * l'autre. Le parcours gratuit se reconnaît à ce qu'il annonce, et les deux
   * payants se départagent d'eux-mêmes : leurs chiffres sont côte à côte.
   */
  const choices: NavChoice[] | null = useMemo(() => {
    if (!proposals?.length || status !== "choosing") return null;
    const anchors = bubbleAnchors(proposals.map((p) => p.route.points));
    const front = highlighted ?? proposals[0].id;
    return proposals.map((proposal, index) => ({
      id: proposal.id,
      geometry: proposal.route.result.segments[0].geometry,
      traffic: trafficSegments(proposal.route),
      at: anchors[index],
      title: durationLabel(proposal.route.durationSeconds),
      detail: tollLabel(proposal.toll),
      active: proposal.id === front,
      // Le premier contact met la proposition en avant, le second la retient :
      // au doigt, il n'y a pas de survol, et partir sur un itinéraire qu'on
      // voulait seulement regarder serait le plus désagréable des raccourcis.
      onPick: () => {
        if (proposal.id === front) start(proposal.id);
        else setHighlighted(proposal.id);
      },
    }));
  }, [proposals, status, highlighted, start]);

  /**
   * Le cadrage qui fait tenir toutes les propositions à l'écran.
   *
   * Il n'est rejoué qu'au changement de jeton — ici, la liste des propositions —
   * et surtout pas quand on en met une en avant : la carte se recadrerait à
   * chaque fois qu'on touche une bulle, et l'on perdrait l'endroit qu'on était
   * en train de regarder.
   */
  const frame = useMemo(() => {
    if (!proposals?.length || status !== "choosing") return null;
    let west = 180, south = 90, east = -180, north = -90;
    for (const proposal of proposals) {
      for (const point of proposal.route.points) {
        if (point.lon < west) west = point.lon;
        if (point.lon > east) east = point.lon;
        if (point.lat < south) south = point.lat;
        if (point.lat > north) north = point.lat;
      }
    }
    return {
      bbox: [west, south, east, north] as [number, number, number, number],
      token: proposals.map((p) => p.id).join("-") + proposals.length,
    };
  }, [proposals, status]);

  // La flèche et le centre de la caméra, mis à jour **une fois par relevé**,
  // pendant le rendu, en comparant au relevé déjà compté (patron « valeur du
  // rendu précédent » de React). Un `useMemo` les écrivait dans des refs : un
  // rendu rejoué par React les faisait avancer deux fois.
  let arrowTrack = pose.arrow;
  let cameraCenter = pose.center;
  if (active && status !== "choosing" && fix && (pose.fix !== fix || pose.progress !== progress)) {
    // La flèche : aimantée au trait sur le parcours, où elle n'avance que vers
    // l'avant ; à sa vraie position dès qu'on s'en écarte, pour que le recalcul
    // se comprenne.
    if (route && progress && !isOffRoute(progress)) {
      const last = arrowTrack?.route === route ? arrowTrack.meters : null;
      const jitterBack =
        last !== null && progress.traveledMeters < last && last - progress.traveledMeters < ARROW_BACKTRACK_METERS;
      arrowTrack = { route, meters: jitterBack && last !== null ? last : progress.traveledMeters };
    } else {
      arrowTrack = null;
    }
    const reading = arrowTrack ? pointAtMeters(arrowTrack.route, arrowTrack.meters) : { lon: fix.lon, lat: fix.lat };
    // La zone morte : sous quelques mètres, on garde le centre précédent. Sans
    // elle, la carte dérive à l'arrêt au rythme du tremblement du GPS. Un
    // nouveau parcours repart du relevé.
    cameraCenter =
      pose.route === route && cameraCenter && distance(cameraCenter, reading) < CAMERA_DEAD_ZONE ? cameraCenter : reading;
    setPose({ fix, progress, route, arrow: arrowTrack, center: cameraCenter });
  }

  const map: NavMapState | null = useMemo(() => {
    // Pendant le choix, la carte ne suit personne : elle montre les parcours et
    // se laisse déplacer. C'est tout l'intérêt de ne plus poser la question
    // dans une fenêtre — on veut pouvoir aller voir par où ça passe.
    if (active && status === "choosing") {
      return { position: null, heading: 0, choices, boldRoute: false, camera: null, frame };
    }
    if (!active || !fix || !cameraCenter) return null;
    const moving = fix.heading !== null && (fix.speed ?? 0) > HEADING_MIN_SPEED;
    const heading = moving ? (fix.heading as number) : (progress?.pathBearing ?? 0);
    // `heading` n'oriente que la caméra ; la flèche prend le cap du tracé sous
    // elle quand elle y est aimantée.
    const arrow = arrowTrack ? pointAtMeters(arrowTrack.route, arrowTrack.meters) : { lon: fix.lon, lat: fix.lat };
    const arrowHeading = arrowTrack ? bearingAround(arrowTrack.route, arrowTrack.meters) : heading;
    const center = cameraCenter;

    const zoom =
      cameraMode === "adaptive" && progress?.next
        ? zoomFor(progress.next.distanceMeters, center.lat)
        : ZOOM_DEFAULT;

    return {
      position: arrow,
      // `heading` n'oriente que la flèche ; la caméra garde son propre cap.
      heading: arrowHeading,
      choices: null,
      // Le trait s'épaissit une fois qu'on roule dessus.
      boldRoute: true,
      largeArrow: true,
      traffic: liveTraffic,
      camera: follow
        ? { center, bearing: heading, pitch: NAV_PITCH, zoom, paddingTop: paddingTop() }
        : null,
      frame: null,
    };
  }, [active, fix, progress, follow, cameraMode, status, choices, frame, liveTraffic, arrowTrack, cameraCenter]);

  return {
    active,
    status,
    proposals,
    proposalsAt,
    chosen,
    route,
    progress,
    speed,
    alert,
    // Une position refusée ou introuvable se dit tant qu'elle dure.
    error: error ?? (!simulating ? live.error : null),
    rerouting,
    trafficGainSeconds,
    eta,
    follow,
    destinationName,
    // Pendant le choix, ce sont les propositions qui sont tracées (`choices`),
    // chacune à son état : rien à dessiner ici, sans quoi l'itinéraire retenu
    // se superposerait à elles.
    mapRoute: active ? (route?.result ?? null) : null,
    map,
    choose,
    start,
    stop,
    recenter: useCallback(() => setFollow(true), []),
    notifyPan: useCallback(() => setFollow(false), []),
    simulating,
    toggleSimulation: useCallback(() => setSimulating((current) => !current), []),
  };
}

/** Les points encore à atteindre, une fois retirées les étapes franchies. */
function targetsAhead(route: CarRoute, progress: CarProgress, targets: LonLat[]): LonLat[] {
  const passed = route.steps.filter(
    (step) => step.maneuver.waypoint !== null && step.atMeters <= progress.traveledMeters
  ).length;
  return targets.slice(Math.min(passed, targets.length - 1));
}

/** Ce que le suivi de position rend, réexporté pour le panneau. */
export type { NavFix };
/** Ce que le compteur affiche, réexporté pour le panneau. */
export type { SpeedState };
