import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LonLat, RouteResult } from "../types";
import { getNavRoute, type NavRoute } from "./route";
import { computeProgress, pathUpTo, rerouteRetryDelayMs, OFF_ROUTE_FIXES, OFF_ROUTE_METERS, REROUTE_MIN_GAP_MS, type NavProgress } from "./progress";
import type { CarTraffic, TrafficSegment } from "./car/carTraffic";
import { useNavPosition, type NavFix } from "./useNavPosition";
import { useSimulatedPosition } from "./simulate";
import { useStepCounter, estimateSteps } from "./useStepCounter";
import { sampleElevationAlong } from "./elevation";
import { reverseGeocode } from "../services/geocode";
import { historyRetention, useNavCameraMode, walkSummaryEnabled } from "./settings";
import { purgeTrips, saveTrip, type Trip } from "./history";
import { navText } from "./strings";
import { useWakeLock } from "./useWakeLock";
import { useLatest } from "../hooks/useLatest";

// ---------------------------------------------------------------------------
// La session de navigation : elle tient le trajet, la position, l'avancement,
// et décide du recalcul.
//
// C'est le seul objet que l'application manipule. `App` l'appelle, lui donne un
// parcours au départ, et lui passe deux valeurs à la carte : le trajet à
// dessiner et l'état de la caméra. Tout le reste — la projection, les
// manœuvres, le profil — se joue dans ce dossier.
// ---------------------------------------------------------------------------

/**
 * Inclinaison du guidage : **aucune**, la carte reste vue de dessus.
 *
 * Une caméra penchée dégage bien plus de terrain devant le marcheur, mais elle
 * écrase les distances vers l'horizon : deux rues éloignées s'y confondent, et
 * un plan cesse de se lire comme un plan. C'est le décentrement du repère qui
 * fait le travail à sa place (voir `WALKER_AT`) — la place gagnée passe devant
 * sans que rien ne soit déformé.
 *
 * Conséquence utile : le calcul du cadrage ci-dessous, fait sur la résolution du
 * sol à plat, est **exact** et non plus approché.
 */
const NAV_PITCH = 0;

// --- Cadrage : la manœuvre à venir doit tenir dans l'écran ------------------
//
// Le zoom n'est pas une constante mais se **déduit de la distance à la
// prochaine manœuvre** : à 300 m d'un virage, la carte s'écarte assez pour
// montrer d'un coup où l'on est et où l'on tourne ; à 50 m, elle se resserre
// sur le carrefour, qui est alors la seule chose à regarder.
//
// La carte étant vue de dessus, la résolution du sol est la même partout à
// l'écran : le calcul ci-dessous est exact, et la manœuvre tombe bien à la
// hauteur annoncée. C'est ce qui permet de la loger juste sous le bandeau sans
// marge de sécurité inventée.

/** Résolution du sol au zoom 0, en mètres par pixel, à l'équateur. */
const GROUND_RESOLUTION = 156543.03392;

/**
 * Zoom de repli : celui du cadrage fixe, et celui du cadrage adaptatif tant
 * qu'aucune manœuvre n'est encore connue.
 */
const ZOOM_DEFAULT = 17.5;

/**
 * Bornes du cadrage. Sans le plancher, une longue ligne droite ferait reculer
 * la caméra jusqu'à ce que les rues ne se lisent plus ; sans le plafond, les
 * derniers mètres avant un virage colleraient le nez au trottoir.
 */
const ZOOM_MIN = 15.5;
const ZOOM_MAX = 18.5;

/**
 * Où le marcheur se tient dans la hauteur de l'écran, du haut vers le bas.
 * Centré, la moitié de la vue montrerait le chemin déjà parcouru — celui qu'on
 * ne regarde pas. Aux deux tiers, la place gagnée passe devant lui, là où l'on
 * cherche le prochain carrefour. C'est ce décentrement, et non une caméra
 * penchée, qui donne au guidage sa vue vers l'avant.
 */
const WALKER_AT = 0.68;

/**
 * Part de la hauteur de l'écran séparant le marcheur de la manœuvre à venir.
 * Le repère étant assis à `WALKER_AT`, la manœuvre se pose donc à
 * `WALKER_AT − LOOK_AHEAD_SHARE` du haut, soit un quart de la hauteur : sous le
 * bandeau de manœuvre, qui occupe le sixième supérieur.
 *
 * **C'est le seul réglage à toucher** si la manœuvre paraît trop haute ou trop
 * basse dans l'écran : le baisser écarte la caméra et ramène la manœuvre vers
 * le marcheur, le monter la rapproche du bord haut.
 */
const LOOK_AHEAD_SHARE = 0.42;

/**
 * La marge haute qui assied le marcheur à `WALKER_AT` de la hauteur.
 *
 * MapLibre place le centre au milieu de ce qui reste sous la marge : pour que
 * le repère tombe à la fraction `f`, il faut retirer `(2f − 1)` de hauteur par
 * le haut.
 */
function paddingTop(): number {
  return Math.max(0, (2 * WALKER_AT - 1) * window.innerHeight);
}

/** Le zoom qui fait tenir une manœuvre à `distance` mètres dans l'écran. */
function zoomFor(distanceMeters: number, lat: number): number {
  // Un écran de moins de 500 px de haut existe (clavier ouvert, fenêtre
  // réduite) : le plancher évite un zoom absurde pour une raison passagère.
  const pixels = Math.max(200, window.innerHeight * LOOK_AHEAD_SHARE);
  // La manœuvre est parfois sous nos pieds : sans ce plancher, la division
  // rendrait l'infini.
  const metersPerPixel = Math.max(5, distanceMeters) / pixels;
  const zoom = Math.log2((GROUND_RESOLUTION * Math.cos((lat * Math.PI) / 180)) / metersPerPixel);
  // Arrondi au vingtième : le zoom suit une distance qui change à chaque
  // relevé, et une valeur au millième relancerait une animation pour rien.
  const rounded = Math.round(zoom * 20) / 20;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, rounded));
}

/**
 * En dessous de cette vitesse, le cap de l'appareil n'est pas fiable — à
 * l'arrêt, un téléphone annonce n'importe quelle direction. On lui préfère
 * alors celle du tracé, qui est de toute façon celle qu'il faut suivre.
 */
const HEADING_MIN_SPEED = 1;

export type NavStatus = "idle" | "computing" | "running" | "arrived" | "error";

/** Ce que la carte doit faire pendant le guidage. */
export interface NavCamera {
  center: LonLat;
  bearing: number;
  pitch: number;
  zoom: number;
  /**
   * Marge haute, en pixels, dans laquelle la carte ne place pas le centre :
   * c'est elle qui **fait descendre le marcheur dans l'écran**. MapLibre centre
   * le point dans ce qui reste une fois la marge retirée — une marge en haut
   * pousse donc le repère vers le bas, et dégage devant lui la place que le
   * parcours à venir demande.
   */
  paddingTop: number;
}

/**
 * Un itinéraire proposé, dessiné sur la carte avant qu'on parte.
 *
 * C'est la forme que prend le **choix d'itinéraire en voiture** : plutôt qu'une
 * fenêtre qui masque la carte, les parcours sont tracés côte à côte et chacun
 * porte sa bulle — durée, péage — à l'endroit où il se distingue des autres.
 * On choisit en touchant la bulle, et entre-temps la carte reste entière : on
 * peut la déplacer, zoomer, regarder par où ça passe.
 *
 * Le rappel est porté par la donnée elle-même plutôt que par une prop de
 * `MapView` : la carte n'a pas à savoir ce qu'est un itinéraire voiture, elle
 * dessine ce qu'on lui donne et appelle ce qu'on lui a joint.
 */
export interface NavChoice {
  id: string;
  geometry: GeoJSON.LineString;
  /** Ses tronçons ralentis ou bouchés, colorés sur son tracé. */
  traffic?: TrafficSegment[];
  /** Où poser la bulle : l'endroit où ce parcours s'écarte le plus des autres. */
  at: LonLat;
  /** Première ligne de la bulle — la durée. */
  title: string;
  /** Seconde ligne — le péage, ou ce qu'on en sait. */
  detail: string;
  /** Le parcours mis en avant : tracé plein, bulle colorée. */
  active: boolean;
  onPick: () => void;
}

/**
 * Ce que `MapView` reçoit d'un guidage, à pied comme en transports.
 *
 * Les trois le remplissent différemment, et c'est voulu : le guidage piéton
 * conduit la **caméra** au fil des relevés, celui des transports **cadre** le
 * tronçon en cours et se passe de position — sous terre il n'y en a pas — et la
 * voiture s'en sert d'abord pour montrer les itinéraires entre lesquels on
 * choisit.
 */
export interface NavMapState {
  /** Où se trouve l'utilisateur, `null` quand on l'ignore (souterrain). */
  position: LonLat | null;
  heading: number;
  /**
   * Les itinéraires proposés, tant qu'on n'a pas choisi. `null` partout
   * ailleurs — un guidage en cours n'a plus rien à comparer.
   */
  choices: NavChoice[] | null;
  /**
   * Trace le parcours plus épais.
   *
   * Vrai pendant un guidage **voiture** seulement. Un trait de six pixels se
   * suit du bout du doigt sur un plan qu'on regarde de près ; au volant on ne
   * regarde pas, on jette un œil, et la carte défile. Le trait doit alors se
   * retrouver d'un coup d'œil, sans être cherché.
   */
  boldRoute: boolean;
  /**
   * Flèche de position **grande, à la manière de Waze** (demande explicite).
   * Vrai en voiture : au volant on la cherche d'un coup d'œil, et à 40 px elle
   * se perdait sous le trait épais du parcours. À pied, elle garde sa taille.
   */
  largeArrow?: boolean;
  /**
   * Le trafic sur le parcours suivi — tronçons colorés et repères d'incident —
   * pendant une navigation **voiture**. Absent ailleurs.
   */
  traffic?: CarTraffic | null;
  /** Caméra à tenir, `null` en transports ou si la carte a été reprise en main. */
  camera: NavCamera | null;
  /**
   * Emprise à cadrer d'un seul coup. Elle n'est rejouée qu'au changement de
   * `token` : sans lui, la carte relancerait son animation à chaque rendu.
   */
  frame: { bbox: [number, number, number, number]; token: string } | null;
  /**
   * Un tracé à dessiner tel quel, dans sa couleur : celui d'une course en
   * cours (`running/`). Absent des navigations, qui dessinent leur itinéraire.
   */
  trace?: { points: LonLat[]; color: string } | null;
}

export interface NavSession {
  active: boolean;
  status: NavStatus;
  route: NavRoute | null;
  progress: NavProgress | null;
  fix: NavFix | null;
  error: string | null;
  /** Vrai pendant un recalcul consécutif à un écart au parcours. */
  rerouting: boolean;
  /** Vrai tant que la carte suit le marcheur. */
  follow: boolean;
  /** Le nom de l'arrivée, tel que le panneau d'itinéraire l'affichait. */
  destinationName: string | null;
  /** Le trajet à dessiner sur la carte, `null` hors guidage. */
  mapRoute: RouteResult | null;
  /** L'état à passer à `MapView`. */
  map: NavMapState | null;
  /**
   * Démarre le guidage. Un nom laissé vide — « ma position », qui n'en a pas —
   * est résolu en **adresse** par géocodage inverse : c'est elle qui doit
   * figurer dans la fiche de fin et dans l'historique, où « Ma position » ne
   * voudrait plus rien dire six mois après.
   */
  start: (points: LonLat[], names?: { from?: string | null; to?: string | null }) => void;
  /**
   * Clôt le trajet : la fiche de fin s'ouvre et le trajet part à l'historique.
   * Appelée par le bouton « Terminer » comme par l'arrivée.
   */
  finish: () => void;
  /** Le trajet qui vient de s'achever, tant que sa fiche est ouverte. */
  summary: Trip | null;
  stop: () => void;
  /** La carte reprend le suivi du marcheur. */
  recenter: () => void;
  /** L'utilisateur a déplacé la carte : le suivi s'arrête. */
  notifyPan: () => void;
  /** Simulation d'une marche (développement seulement). */
  simulating: boolean;
  toggleSimulation: () => void;
}

interface Request {
  points: LonLat[];
  /** Vrai quand la demande fait suite à un écart, et non à un départ. */
  reroute: boolean;
}

export function useNavigation(): NavSession {
  const [active, setActive] = useState(false);
  // Les deux extrémités, sous le nom qu'elles porteront dans l'historique. Un
  // état et non une ref : le bandeau d'arrivée les affiche, et l'adresse d'un
  // point de départ n'arrive qu'après le géocodage inverse.
  const [names, setNames] = useState<{ from: string; to: string }>({ from: "", to: "" });
  // Chaque départ porte un numéro : c'est lui qui déclenche la résolution des
  // noms, et qui empêche une réponse tardive de renommer le trajet suivant.
  const [sessionId, setSessionId] = useState(0);
  const [request, setRequest] = useState<Request | null>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [status, setStatus] = useState<NavStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // La dernière requête qui a abouti ou échoué : un recalcul est en cours tant
  // que la requête courante n'y est pas.
  const [settledRequest, setSettledRequest] = useState<Request | null>(null);
  const rerouting = request?.reroute === true && settledRequest !== request;
  const [progress, setProgress] = useState<NavProgress | null>(null);
  const [follow, setFollow] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [summary, setSummary] = useState<Trip | null>(null);

  // Les points encore à atteindre : l'arrivée, et les étapes qu'on n'a pas
  // encore passées. C'est de cette liste que part un recalcul — refaire le
  // trajet vers une étape déjà franchie ferait revenir sur ses pas.
  const targetsRef = useRef<LonLat[]>([]);
  // Le point du tracé trouvé au relevé précédent : la recherche du suivant
  // commence autour de lui plutôt qu'au départ (voir `progress.ts`).
  const indexRef = useRef(0);
  const offRouteRef = useRef(0);
  const statusRef = useLatest(status);
  const reroutingRef = useLatest(rerouting);
  // Recalculs ratés d'affilée, et l'instant avant lequel on n'en retente pas
  // (`rerouteRetryDelayMs`).
  const rerouteFailuresRef = useRef(0);
  const rerouteRetryAtRef = useRef(0);
  // Et l'instant avant lequel on ne recalcule pas **même quand tout marche** :
  // `rerouteRetryAtRef` ne protège que de l'acharnement après un échec, rien
  // n'empêchait d'enchaîner les recalculs qui aboutissent (voir
  // `REROUTE_MIN_GAP_MS`).
  const rerouteGapUntilRef = useRef(0);

  // Ce qui a été **réellement parcouru**, accumulé d'un itinéraire à l'autre.
  // Un recalcul remplace le trajet en cours : sans cette accumulation, le
  // kilomètre déjà marché avant le détour disparaîtrait de l'historique, et le
  // temps annoncé auquel on se compare repartirait de zéro.
  const coveredRef = useRef<Covered>(emptyCovered());
  const startedAtRef = useRef(0);
  const namesRef = useLatest(names);
  /** Les coordonnées des deux extrémités, pour le géocodage inverse. */
  const endpointsRef = useRef<{ from: LonLat; to: LonLat } | null>(null);
  // Le trajet courant et son avancement, relus par `finish()` : elle est
  // appelée depuis un bouton comme depuis l'effet d'arrivée, et ne peut pas
  // dépendre de la fermeture de l'un ou de l'autre.
  const routeRef = useLatest(route);
  const progressRef = useLatest(progress);
  const summaryRef = useLatest(summary);

  // Fixe ou adaptatif, au choix de l'utilisateur (fenêtre des paramètres).
  // L'abonnement compte : les menus restent ouverts pendant le guidage, on peut
  // donc basculer le réglage en marchant, et le cadrage doit suivre sans
  // attendre le relevé GPS suivant.
  const cameraMode = useNavCameraMode();

  // Les capteurs s'arrêtent dès que la fiche de fin est ouverte : le trajet est
  // clos, continuer à relever position et pas fausserait des chiffres déjà
  // affichés.
  const running = active && summary === null;
  const live = useNavPosition(running && !simulating);
  const simulated = useSimulatedPosition(route, running && simulating);
  const fix = simulating ? simulated : live.fix;
  const { read: readSteps } = useStepCounter(running);
  // L'écran s'éteindrait au bout d'une minute, et le guidage avec lui.
  useWakeLock(running);

  const start = useCallback((points: LonLat[], given?: { from?: string | null; to?: string | null }) => {
    if (points.length < 2) return;
    setActive(true);
    setNames({ from: given?.from ?? "", to: given?.to ?? "" });
    endpointsRef.current = { from: points[0], to: points[points.length - 1] };
    setSessionId((current) => current + 1);
    setFollow(true);
    setSimulating(false);
    setProgress(null);
    setRoute(null);
    setError(null);
    setSummary(null);
    setStatus("computing");
    indexRef.current = 0;
    offRouteRef.current = 0;
    targetsRef.current = points.slice(1);
    coveredRef.current = emptyCovered();
    startedAtRef.current = Date.now();
    setRequest({ points, reroute: false });
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setSimulating(false);
    setRequest(null);
    setRoute(null);
    setProgress(null);
    setError(null);
    setStatus("idle");
    setNames({ from: "", to: "" });
    endpointsRef.current = null;
    setSummary(null);
    coveredRef.current = emptyCovered();
  }, []);

  /**
   * Clôt le trajet. La fiche s'ouvre **tout de suite**, avec ce qu'on sait déjà
   * — distance, temps, pas — et le profil du dénivelé s'y ajoute quand les
   * tuiles d'altitude ont répondu : faire attendre devant un écran vide au
   * moment où l'on vient d'arriver serait le pire endroit pour un chargement.
   *
   * L'enregistrement suit la même logique : le trajet part à l'historique
   * aussitôt, puis y est réécrit avec son profil. Fermer la fiche avant que le
   * relief soit lu ne perd donc que le relief.
   */
  const finish = useCallback(() => {
    if (summaryRef.current) return; // déjà clos : l'arrivée et le bouton peuvent tomber ensemble
    const covered = merge(coveredRef.current, routeRef.current, progressRef.current);
    const trip = buildTrip(covered, {
      startedAt: startedAtRef.current,
      names: namesRef.current,
      steps: readSteps(),
      completed: statusRef.current === "arrived",
    });
    // Fiche coupée dans la fenêtre « Modes » : le trajet s'enregistre de la
    // même façon, mais la navigation se ferme aussitôt, et le profil qui arrive
    // ensuite ne doit rien rouvrir.
    const showSummary = walkSummaryEnabled();
    if (showSummary) {
      setSummary(trip);
      setStatus("arrived");
    } else {
      // Tient lieu de garde : l'arrivée et le bouton peuvent tomber ensemble.
      summaryRef.current = trip;
    }

    // « Ne jamais enregistrer » n'est pas un réglage à moitié : rien ne part à
    // l'historique, et la fiche de fin reste affichée — elle rend compte du
    // trajet qu'on vient de faire, elle n'en garde pas la trace.
    if (historyRetention() !== "off") {
      void purgeTrips()
        .catch(() => {})
        .then(() => saveTrip(trip))
        .then(() => addProfile(trip, showSummary ? setSummary : () => {}))
        .catch(() => {
          /* base indisponible (mode privé, quota) : la fiche reste juste */
        });
    }

    if (!showSummary) stop();
  }, [readSteps, stop, progressRef, summaryRef, routeRef, namesRef, statusRef]);

  // Le calcul, au départ comme après un écart. Un recalcul ne remplace le
  // trajet **que s'il aboutit** : la réponse d'OSRM peut manquer, et perdre le
  // guidage en cours parce qu'un recalcul a échoué serait le pire moment.
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    let cancelled = false;
    if (!request.reroute) rerouteFailuresRef.current = rerouteRetryAtRef.current = 0;

    getNavRoute(request.points, controller.signal)
      .then((next) => {
        if (cancelled) return;
        setRoute(next);
        setProgress(null);
        setStatus("running");
        setError(null);
        indexRef.current = 0;
        offRouteRef.current = 0;
        rerouteFailuresRef.current = rerouteRetryAtRef.current = 0;
        // Un recalcul qui aboutit ouvre un plancher avant le suivant. Le départ,
        // lui, n'en ouvre aucun : s'écarter dès les premiers mètres doit se
        // corriger tout de suite.
        rerouteGapUntilRef.current = request.reroute ? Date.now() + REROUTE_MIN_GAP_MS : 0;
      })
      .catch((e) => {
        if (cancelled || controller.signal.aborted) return;
        if (request.reroute) {
          rerouteFailuresRef.current += 1;
          rerouteRetryAtRef.current = Date.now() + rerouteRetryDelayMs(rerouteFailuresRef.current);
        }
        const message = e instanceof Error ? e.message : navText("nav.errorNoRoute");
        // Un premier calcul raté arrête tout ; un recalcul raté laisse en place
        // le trajet précédent, qu'on peut encore suivre à l'œil.
        if (!request.reroute) setStatus("error");
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setSettledRequest(request);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [request]);

  // L'avancement, à chaque relevé.
  useEffect(() => {
    if (!route || !fix || !active) return;
    const next = computeProgress(route, fix, indexRef.current);
    indexRef.current = next.index;
    setProgress(next);

    if (next.arrived) {
      setStatus("arrived");
      offRouteRef.current = 0;
      // On y est : la fiche de fin s'ouvre d'elle-même. `finish()` se garde de
      // s'exécuter deux fois si le bouton « Terminer » est pressé au même
      // moment.
      progressRef.current = next;
      finish();
      return;
    }
    if (statusRef.current === "error") setStatus("running");

    // Recalcul : il faut plusieurs relevés d'affilée hors du tracé. Un relevé
    // isolé rebondit de vingt mètres sous les arbres ou entre deux immeubles ;
    // recalculer à chaque rebond ferait clignoter l'instruction et enchaînerait
    // les appels.
    if (next.offsetMeters > OFF_ROUTE_METERS) {
      offRouteRef.current += 1;
      if (
        offRouteRef.current >= OFF_ROUTE_FIXES &&
        !reroutingRef.current &&
        Date.now() >= Math.max(rerouteRetryAtRef.current, rerouteGapUntilRef.current)
      ) {
        offRouteRef.current = 0;
        const remaining = targetsAhead(route, next, targetsRef.current);
        targetsRef.current = remaining;
        // Le trajet qu'on abandonne laisse derrière lui ce qu'on en a fait :
        // sa portion de tracé, ses mètres et le temps qu'il annonçait pour eux.
        // Le nouveau repartira de zéro, et l'historique additionnera les deux.
        coveredRef.current = merge(coveredRef.current, route, next);
        setRequest({ points: [{ lon: fix.lon, lat: fix.lat }, ...remaining], reroute: true });
      }
    } else {
      offRouteRef.current = 0;
    }
  }, [fix, route, active, finish, progressRef, statusRef, reroutingRef]);

  /**
   * Donne une adresse aux extrémités qui n'ont pas de nom.
   *
   * « Ma position » n'est pas un lieu : c'est un rôle. Il convient au panneau
   * d'itinéraire, où l'on sait où l'on est, mais pas à une fiche de fin ni à un
   * historique relu des mois plus tard, où seule l'adresse dit quelque chose.
   * Le géocodage inverse est celui du reste de l'application (Photon, puis la
   * BAN en repli).
   *
   * Le trajet démarre sans attendre : la réponse arrive en quelques centaines
   * de millisecondes, bien avant qu'on ait fini de marcher, et un échec laisse
   * simplement l'extrémité sans nom plutôt que d'empêcher de partir.
   */
  useEffect(() => {
    const endpoints = endpointsRef.current;
    if (!sessionId || !endpoints) return;
    let cancelled = false;

    async function name(point: LonLat): Promise<string> {
      const found = await reverseGeocode(point.lon, point.lat).catch(() => null);
      // L'adresse d'abord : c'est elle qu'on a demandée. Le nom du lieu ne sert
      // que là où le géocodeur n'a pas d'adresse à donner — un parc, une place.
      return found?.address ?? found?.name ?? "";
    }

    void (async () => {
      const current = namesRef.current;
      const [from, to] = await Promise.all([
        current.from ? current.from : name(endpoints.from),
        current.to ? current.to : name(endpoints.to),
      ]);
      // Un trajet a pu être relancé pendant la requête : `sessionId` a changé,
      // l'effet a été nettoyé, et ces noms ne sont plus ceux du bon parcours.
      if (!cancelled) setNames({ from, to });
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, namesRef]);


  const map: NavMapState | null = useMemo(() => {
    if (!active || !fix) return null;
    // Le cap de l'appareil quand il marche vraiment, sinon celui du tracé :
    // à l'arrêt, un téléphone annonce n'importe quelle direction et la carte
    // se mettrait à tourner sur elle-même.
    const moving = fix.heading !== null && (fix.speed ?? 0) > HEADING_MIN_SPEED;
    const heading = moving ? (fix.heading as number) : (progress?.pathBearing ?? 0);
    // La caméra se cale sur le tracé et non sur le relevé brut : le point GPS
    // saute d'un mètre à l'autre, et la carte tremblerait à chaque relevé. Hors
    // parcours, en revanche, c'est bien la position réelle qu'il faut montrer.
    const onRoute = progress && progress.offsetMeters <= OFF_ROUTE_METERS;
    const center = onRoute ? progress.snapped : { lon: fix.lon, lat: fix.lat };

    // Le cadrage suit la manœuvre à venir — quand l'utilisateur l'a voulu
    // ainsi. La carte reste centrée sur le marcheur dans les deux cas : un
    // centre qui glisserait vers le carrefour déplacerait la flèche à l'écran,
    // et on ne saurait plus où poser les yeux ; c'est le **zoom** qui s'ajuste,
    // et lui seul.
    const zoom =
      cameraMode === "adaptive" && progress?.next
        ? zoomFor(progress.next.distanceMeters, center.lat)
        : ZOOM_DEFAULT;

    return {
      position: { lon: fix.lon, lat: fix.lat },
      heading,
      camera: follow
        ? { center, bearing: heading, pitch: NAV_PITCH, zoom, paddingTop: paddingTop() }
        : null,
      // Le guidage piéton conduit la caméra relevé par relevé : il n'a rien à
      // cadrer d'un bloc, et rien à faire choisir — on part sur le trajet que
      // le panneau d'itinéraire affichait.
      choices: null,
      boldRoute: false,
      frame: null,
    };
  }, [active, fix, progress, follow, cameraMode]);

  return {
    active,
    status,
    route,
    progress,
    fix,
    // Le refus de géolocalisation est le seul échec de position qui arrête le
    // guidage : sans autorisation, il n'y a rien à attendre. Il se dit tant
    // qu'il dure, lu tel que le suivi le rend.
    error: error ?? (!simulating ? live.error : null),
    rerouting,
    follow,
    destinationName: names.to || null,
    mapRoute: active ? (route?.result ?? null) : null,
    map,
    start,
    finish,
    summary,
    stop,
    recenter: useCallback(() => setFollow(true), []),
    notifyPan: useCallback(() => setFollow(false), []),
    simulating,
    toggleSimulation: useCallback(() => setSimulating((current) => !current), []),
  };
}

/** Ce qui a été parcouru, accumulé d'un itinéraire à l'autre. */
interface Covered {
  meters: number;
  /** Ce que les moteurs annonçaient pour ces mètres-là. */
  announcedSeconds: number;
  points: LonLat[];
}

function emptyCovered(): Covered {
  return { meters: 0, announcedSeconds: 0, points: [] };
}

/**
 * Ajoute à l'accumulation ce qui a été fait du trajet en cours.
 *
 * Le temps annoncé retenu est celui de la **portion parcourue** — la durée du
 * trajet moins ce qu'il en restait — et non la durée entière : s'arrêter à
 * mi-chemin doit se comparer à la moitié annoncée. C'est ce que veut dire
 * « ajusté selon l'endroit où l'on appuie sur Terminer ».
 */
function merge(covered: Covered, route: NavRoute | null, progress: NavProgress | null): Covered {
  if (!route || !progress) return covered;
  const points = pathUpTo(route, progress.traveledMeters);
  return {
    meters: covered.meters + progress.traveledMeters,
    announcedSeconds:
      covered.announcedSeconds + Math.max(0, route.durationSeconds - progress.remainingSeconds),
    // Le premier point du nouveau tracé est l'endroit où l'on a quitté le
    // précédent : le répéter ferait un segment de longueur nulle.
    points: covered.points.length ? [...covered.points, ...points.slice(1)] : points,
  };
}

/** Le trajet tel qu'il sera montré et gardé. */
function buildTrip(
  covered: Covered,
  context: {
    startedAt: number;
    names: { from: string; to: string };
    steps: number | null;
    completed: boolean;
  }
): Trip {
  const endedAt = Date.now();
  return {
    id: `${endedAt}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: context.startedAt,
    endedAt,
    from: context.names.from,
    to: context.names.to,
    distanceMeters: covered.meters,
    elapsedSeconds: Math.max(0, (endedAt - context.startedAt) / 1000),
    announcedSeconds: covered.announcedSeconds,
    // Le capteur quand il a compté, la distance sinon : la fiche dit laquelle
    // des deux, un chiffre mesuré et un chiffre déduit ne se valent pas.
    steps: context.steps ?? estimateSteps(covered.meters),
    stepSource: context.steps === null ? "estimate" : "sensor",
    points: covered.points,
    profile: null,
    ascent: null,
    descent: null,
    completed: context.completed,
  };
}

/**
 * Lit le relief du trajet et l'y ajoute, dans l'historique comme dans la fiche
 * ouverte. Sans réseau — ou sur une côte que le modèle d'altitude ne couvre
 * pas — le trajet reste enregistré sans son profil, et le détail le dira.
 */
async function addProfile(trip: Trip, publish: (update: (t: Trip | null) => Trip | null) => void) {
  if (trip.points.length < 2) return;
  const profile = await sampleElevationAlong(trip.points);
  const enriched: Trip = {
    ...trip,
    profile: profile.samples,
    ascent: profile.ascent,
    descent: profile.descent,
  };
  await saveTrip(enriched);
  // La fiche a pu être refermée entre-temps : on ne réveille pas un résumé
  // qui n'est plus le bon.
  publish((current) => (current && current.id === trip.id ? enriched : current));
}

/**
 * Les points encore à atteindre, une fois retirées les étapes déjà franchies.
 *
 * Elles se reconnaissent aux arrivées intermédiaires du trajet en cours : leur
 * ordre est celui de la liste passée au départ, et un recalcul repart de ce
 * qu'il en reste.
 */
function targetsAhead(route: NavRoute, progress: NavProgress, targets: LonLat[]): LonLat[] {
  const passed = route.steps.filter(
    (step) => step.maneuver.waypoint !== null && step.atMeters <= progress.traveledMeters
  ).length;
  // L'arrivée reste dans la liste quoi qu'il arrive : sans elle, il n'y aurait
  // plus rien à calculer.
  return targets.slice(Math.min(passed, targets.length - 1));
}
