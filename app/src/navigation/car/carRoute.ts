import { CONFIG } from "../../config";
import type { LonLat, RouteResult } from "../../types";
import { distance } from "../geo";
import { navText } from "../strings";
import { readTrafficSection, type TrafficSection } from "./carTraffic";

// ---------------------------------------------------------------------------
// Le trajet voiture à guider.
//
// Deux moteurs derrière une seule forme de réponse (`CarRoute`) :
//
// - **TomTom** quand `VITE_TOMTOM_KEY` est renseignée. Lui seul donne ce que la
//   voiture demande et qu'OSRM ignore : la durée avec le trafic **en cours**,
//   les sections à péage, les vitesses limites et les voies à emprunter.
// - **OSRM** sinon, le même `routed-car` que le panneau d'itinéraire. Le mode
//   voiture ne cesse donc jamais de fonctionner faute de clé — c'est la règle
//   du projet, celle de Mapillary et de la vigilance météo. Il rend un guidage
//   complet, simplement sans trafic, sans péage, sans vitesses et sans voies ;
//   l'interface dit ce qui manque au lieu de faire semblant.
//
// Pour que la suite n'ait qu'un vocabulaire à connaître, les manœuvres d'OSRM
// sont traduites **ici** dans celui de TomTom, et non l'inverse : c'est le plus
// riche des deux (il distingue l'entrée d'autoroute de l'insertion, la sortie
// du simple « serrez à droite »), et perdre cette finesse pour aligner sur le
// plus pauvre appauvrirait le guidage là où la clé existe.
//
// Comme pour la marche, le tracé est **recomposé à partir des points rendus**
// et l'avancement se mesure dessus : la ligne dessinée et celle sur laquelle on
// se projette sont ainsi la même.
// ---------------------------------------------------------------------------

/** Bleu d'itinéraire, celui de `services/routing.ts`. */
const ROUTE_COLOR = "#007AFF";

/**
 * Le vocabulaire des manœuvres, réduit à ce qui change le dessin ou la phrase.
 *
 * TomTom en publie une cinquantaine, qui distinguent par exemple le sens de
 * l'insertion (`MERGE_LEFT_LANE`) : cette nuance-là n'apprend rien au
 * conducteur, qui voit la bretelle. Ce qui compte est le **geste** — tourner,
 * serrer, sortir, faire le tour d'un rond-point.
 */
export type CarManeuverKind =
  | "depart"
  | "arrive"
  | "waypoint"
  | "left"
  | "right"
  | "slightLeft"
  | "slightRight"
  | "sharpLeft"
  | "sharpRight"
  | "keepLeft"
  | "keepRight"
  | "uturn"
  | "straight"
  | "roundabout"
  | "merge"
  | "enterMotorway"
  | "exitMotorway"
  | "fork";

export interface CarManeuver {
  kind: CarManeuverKind;
  /** La voie où l'on arrive, vide si elle n'a pas de nom. */
  street: string;
  /** Le numéro de route à afficher en pastille (`A6`, `N7`), vide sinon. */
  road: string;
  /** Numéro de sortie — de rond-point, ou d'autoroute quand la source le donne. */
  exit: number | null;
  /** Rang du point de passage atteint ; `null` partout ailleurs. */
  waypoint: number | null;
}

export interface CarStep {
  maneuver: CarManeuver;
  /** Distance depuis le départ à laquelle la manœuvre s'exécute. */
  atMeters: number;
  /**
   * Temps depuis le départ, **cumulé** : c'est la forme que TomTom rend, et
   * elle se prête mieux au temps restant qu'une durée par étape — il n'y a rien
   * à sommer, seulement à soustraire.
   */
  atSeconds: number;
  location: LonLat;
}

/** Les voies d'un carrefour, et lesquelles mènent où l'on va. */
export interface LaneAdvice {
  fromMeters: number;
  toMeters: number;
  lanes: { directions: string[]; follow: boolean }[];
}

/** Une portion de route et la vitesse qui y est autorisée. */
export interface SpeedZone {
  fromMeters: number;
  toMeters: number;
  kmh: number;
}

/** Une portion payante du parcours. */
export interface TollSection {
  fromMeters: number;
  toMeters: number;
}

export interface CarRoute {
  points: LonLat[];
  /** Distance cumulée depuis le départ, pour chacun de ces points. */
  measures: number[];
  steps: CarStep[];
  lanes: LaneAdvice[];
  speedZones: SpeedZone[];
  tollSections: TollSection[];
  /**
   * Ralentissements, bouchons, travaux, fermetures et accidents **sur ce
   * parcours**, tels que TomTom les rend avec l'itinéraire (voir
   * `carTraffic.ts`). Vide avec OSRM, qui ne sait rien du trafic.
   */
  traffic: TrafficSection[];
  distanceMeters: number;
  durationSeconds: number;
  /**
   * Retard dû à la circulation, déjà compris dans `durationSeconds`. `null`
   * avec OSRM, qui ne connaît pas le trafic — et « zéro » ne voudrait pas dire
   * la même chose que « on n'en sait rien ».
   */
  trafficDelaySeconds: number | null;
  /** Vrai quand le calcul vient de TomTom : péages, vitesses et voies connus. */
  live: boolean;
  result: RouteResult;
}

export interface CarRouteOptions {
  /** Écarte toute route à péage. */
  avoidTolls?: boolean;
  /** Nombre d'itinéraires de rechange demandés en plus du meilleur. */
  alternatives?: number;
  /**
   * Demande les manœuvres, les voies et les vitesses. Le choix d'itinéraire n'en
   * a pas besoin — il ne compare que des durées et des péages — et les
   * réclamer pour trois itinéraires à la fois multiplie le poids de la réponse
   * par cinq (mesuré : 800 ko contre 160 ko sur Paris → Lyon).
   */
  guidance?: boolean;
  /**
   * Le parcours qu'on suit déjà, pour une **réévaluation en cours de route**.
   *
   * Le moteur repasse alors par ces points sauf s'il trouve nettement mieux :
   * c'est `minDeviationTime` qui fixe ce « nettement », et c'est ce qui
   * distingue une réévaluation d'un simple recalcul. Sans lui, chaque appel
   * rendrait le meilleur trajet de l'instant et le parcours oscillerait au gré
   * des bouffées de trafic.
   *
   * La liste est échantillonnée avant l'envoi (voir `SUPPORT_POINTS`).
   */
  following?: LonLat[];
  /** Gain minimal, en secondes, pour que le moteur propose un autre chemin. */
  minGainSeconds?: number;
  /**
   * Le sens dans lequel roule le véhicule, en degrés depuis le nord.
   *
   * Sans lui, le moteur part d'un point sans savoir de quel côté on va, et
   * choisit volontiers l'autre sens de la rue — ou, après une sortie manquée,
   * un demi-tour vers elle. Vérifié sur TomTom (`vehicleHeading`) : même départ
   * sur les Champs-Élysées, le trajet part vers l'ouest cap à l'ouest, vers
   * l'est cap à l'est. `null` quand on ne le sait pas (à l'arrêt).
   */
  heading?: number | null;
  signal?: AbortSignal;
}

/** Un cap ramené à un entier de 0 à 359, la forme que les moteurs acceptent. */
function headingParam(heading: number): number {
  return Math.round(((heading % 360) + 360) % 360) % 360;
}

/**
 * Nombre de points d'appui envoyés lors d'une réévaluation.
 *
 * Mesuré sur Paris → Lyon (environ 5 200 points de tracé, un appui tous les
 * 1,6 km à ce réglage) : le moteur reconstitue alors le parcours suivi à la
 * minute près. À 150 appuis — un tous les 3,1 km — il le reconstitue
 * généralement aussi, mais **pas toujours** : un relevé a rendu un parcours de
 * 20 km et 25 minutes de plus, parce qu'un appui isolé se raccroche parfois à
 * la mauvaise chaussée (une contre-allée, le sens opposé) et que le moteur
 * s'oblige alors à y passer. Trois cents appuis pèsent une quinzaine de
 * kilo-octets dans le corps de la requête : l'assurance est bon marché.
 *
 * Ce n'est de toute façon pas la seule protection — la session revérifie le
 * gain avant d'adopter quoi que ce soit (voir `useCarNavigation`), et un
 * parcours plus lent est rejeté quelle qu'en soit la cause.
 */
const SUPPORT_POINTS = 300;

/** Vrai si le moteur TomTom est utilisable — c'est-à-dire si une clé existe. */
export function hasLiveEngine(): boolean {
  return CONFIG.TOMTOM_KEY.length > 0;
}

/**
 * Calcule un ou plusieurs itinéraires voiture entre ces points, dans l'ordre.
 *
 * Le premier de la liste est le meilleur au sens demandé ; les suivants sont
 * les itinéraires de rechange, qui servent à chercher un parcours moins cher
 * (voir `proposals.ts`).
 */
export async function getCarRoutes(
  points: LonLat[],
  options: CarRouteOptions = {}
): Promise<CarRoute[]> {
  if (points.length < 2) throw new Error(navText("car.errorNoRoute"));
  // Les deux moteurs sont distants — TomTom comme OSRM. Hors ligne, le dire
  // dans la langue de l'application plutôt que de laisser remonter le
  // « Failed to fetch » du navigateur jusqu'à l'écran de choix.
  if (!navigator.onLine) throw new Error(navText("nav.errorOffline"));
  return hasLiveEngine() ? fetchTomTom(points, options) : [await fetchOsrm(points, options)];
}

// ---------------------------------------------------------------------------
// TomTom
// ---------------------------------------------------------------------------

interface TomTomPoint {
  latitude: number;
  longitude: number;
}

interface TomTomSection {
  sectionType: string;
  startPointIndex: number;
  endPointIndex: number;
  maxSpeedLimitInKmh?: number;
  lanes?: Array<{ directions?: string[]; follow?: string }>;
  // Sections `TRAFFIC` (voir `carTraffic.ts`).
  simpleCategory?: string;
  magnitudeOfDelay?: number;
  delayInSeconds?: number;
  tec?: { causes?: { mainCauseCode?: number }[] };
}

interface TomTomInstruction {
  routeOffsetInMeters: number;
  travelTimeInSeconds: number;
  pointIndex: number;
  point: TomTomPoint;
  maneuver: string;
  street?: string;
  roadNumbers?: string[];
  roundaboutExitNumber?: number;
  exitNumber?: string;
}

interface TomTomResponse {
  routes?: Array<{
    summary: {
      lengthInMeters: number;
      travelTimeInSeconds: number;
      trafficDelayInSeconds?: number;
    };
    legs: Array<{ points: TomTomPoint[] }>;
    sections?: TomTomSection[];
    guidance?: { instructions?: TomTomInstruction[] };
  }>;
  detailedError?: { message?: string };
}

async function fetchTomTom(points: LonLat[], options: CarRouteOptions): Promise<CarRoute[]> {
  const path = points.map((p) => `${p.lat},${p.lon}`).join(":");
  const query = new URLSearchParams({
    key: CONFIG.TOMTOM_KEY,
    routeType: "fastest",
    travelMode: "car",
    // Le trafic **en cours**, et non une moyenne historique : c'est toute la
    // raison d'appeler ce moteur plutôt qu'OSRM.
    traffic: "true",
    computeTravelTimeFor: "all",
    // Le tracé au complet. Sans cela la réponse ne porte que les manœuvres, et
    // il n'y aurait rien sur quoi projeter la position.
    routeRepresentation: "polyline",
  });
  // La langue des instructions ne sert pas à les afficher — elles sont
  // refabriquées dans `carManeuver.ts` pour suivre le réglage de langue de
  // l'application — mais les noms de rue en dépendent.
  query.set("language", "fr-FR");
  // Les sections sont demandées une à une : l'API les cumule.
  query.append("sectionType", "tollRoad");
  // Le trafic **sur le parcours** — ralentissements, travaux, fermetures,
  // accidents — pour le colorer au choix et le signaler en route. Demandé à
  // chaque appel, réévaluations comprises : c'est ce qui le tient à jour sans
  // un appel de plus.
  query.append("sectionType", "traffic");
  if (options.guidance) {
    query.set("instructionsType", "text");
    query.append("sectionType", "speedLimit");
    query.append("sectionType", "lanes");
  }
  if (options.avoidTolls) query.set("avoid", "tollRoads");
  if (options.heading != null) query.set("vehicleHeading", String(headingParam(options.heading)));
  if (options.following?.length) {
    // Le moteur ne s'écarte du parcours suivi que s'il gagne au moins cela.
    query.set("minDeviationTime", String(options.minGainSeconds ?? 300));
    // Et jamais dans le premier kilomètre : on ne fait pas faire demi-tour à
    // quelqu'un qui roule déjà.
    query.set("minDeviationDistance", "1000");
  }
  if (options.alternatives) {
    query.set("maxAlternatives", String(options.alternatives));
    // On cherche des parcours **différents**, pas des variantes du même : sans
    // cela TomTom rend volontiers trois fois la même autoroute à un échangeur
    // près, et aucune ne serait moins chère.
    query.set("alternativeType", "anyRoute");
  }

  // Les points d'appui ne tiennent pas dans une URL : la réévaluation passe
  // donc par POST. Le préflight que cela déclenche est autorisé — mesuré,
  // `access-control-allow-methods: GET,POST` et `content-type` accepté — à la
  // différence du point d'authentification de Météo-France, qui répond au
  // préflight sans en-tête d'origine croisée et oblige à un relais.
  const support = options.following?.length ? sample(options.following, SUPPORT_POINTS) : null;
  const res = await fetch(`${CONFIG.TOMTOM_ROUTING_URL}/${path}/json?${query}`, {
    signal: options.signal,
    ...(support
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supportingPoints: support.map((p) => ({ latitude: p.lat, longitude: p.lon })),
          }),
        }
      : {}),
  });
  const data: TomTomResponse = await res.json().catch(() => ({}) as TomTomResponse);
  if (!res.ok || !data.routes?.length) {
    // Le message de l'API est en anglais et parle de paramètres : il n'a rien à
    // faire sous les yeux de l'utilisateur. Le code de statut, lui, distingue
    // une clé refusée d'un service en panne.
    throw new Error(navText("car.errorService", { status: String(res.status) }));
  }

  return data.routes.map((route) => {
    const points_: LonLat[] = [];
    const measures: number[] = [];
    let traveled = 0;
    // Les points sont concaténés **sans dédoublonnage**, y compris la jonction
    // que deux tronçons consécutifs écrivent tous les deux (vérifié : elle est
    // bien répétée à l'identique). C'est la condition pour que les index de
    // section rendus par l'API désignent le bon point : les écarter décalerait
    // tout ce qui suit la première étape.
    for (const leg of route.legs) {
      for (const p of leg.points) {
        const point = { lon: p.longitude, lat: p.latitude };
        const previous = points_[points_.length - 1];
        if (previous) traveled += distance(previous, point);
        points_.push(point);
        measures.push(traveled);
      }
    }
    if (points_.length < 2) throw new Error(navText("car.errorNoRoute"));

    const at = (index: number) => measures[Math.max(0, Math.min(measures.length - 1, index))];
    const sections = route.sections ?? [];

    const speedZones: SpeedZone[] = [];
    const lanes: LaneAdvice[] = [];
    const tollSections: TollSection[] = [];
    const traffic: TrafficSection[] = [];
    for (const section of sections) {
      const from = at(section.startPointIndex);
      const to = at(section.endPointIndex);
      if (section.sectionType === "SPEED_LIMIT" && section.maxSpeedLimitInKmh) {
        speedZones.push({ fromMeters: from, toMeters: to, kmh: section.maxSpeedLimitInKmh });
      } else if (section.sectionType === "TOLL_ROAD") {
        tollSections.push({ fromMeters: from, toMeters: to });
      } else if (section.sectionType === "LANES" && section.lanes?.length) {
        lanes.push({
          fromMeters: from,
          toMeters: to,
          // `follow` marque les voies qui mènent là où l'on va. C'est
          // exactement l'indication cherchée — se mettre sur la bonne file — et
          // elle vient de la source, sans déduction de notre part.
          lanes: section.lanes.map((lane) => ({
            directions: lane.directions ?? [],
            follow: Boolean(lane.follow),
          })),
        });
      } else if (section.sectionType === "TRAFFIC") {
        const read = readTrafficSection(section);
        if (read) traffic.push(read);
      }
    }
    speedZones.sort((a, b) => a.fromMeters - b.fromMeters);
    lanes.sort((a, b) => a.fromMeters - b.fromMeters);
    tollSections.sort((a, b) => a.fromMeters - b.fromMeters);

    const instructions = route.guidance?.instructions ?? [];
    const steps: CarStep[] = instructions.map((instruction) => ({
      maneuver: {
        kind: tomtomManeuver(instruction.maneuver),
        street: instruction.street ?? "",
        road: instruction.roadNumbers?.[0] ?? "",
        exit:
          instruction.roundaboutExitNumber ??
          (instruction.exitNumber ? Number(instruction.exitNumber) || null : null),
        waypoint: null,
      },
      // La distance mesurée sur **notre** tracé plutôt que le
      // `routeOffsetInMeters` de la source : les deux diffèrent de quelques
      // mètres (somme d'orthodromies contre mesure du moteur), et c'est sur le
      // nôtre qu'on se projette. Les faire diverger poserait la manœuvre à côté
      // du carrefour.
      atMeters: at(instruction.pointIndex),
      atSeconds: instruction.travelTimeInSeconds,
      location: { lon: instruction.point.longitude, lat: instruction.point.latitude },
    }));
    numberWaypoints(steps);

    return {
      points: points_,
      measures,
      steps,
      lanes,
      speedZones,
      tollSections,
      traffic,
      distanceMeters: traveled,
      durationSeconds: route.summary.travelTimeInSeconds,
      trafficDelaySeconds: route.summary.trafficDelayInSeconds ?? 0,
      live: true,
      result: asResult(points_, traveled, route.summary.travelTimeInSeconds),
    };
  });
}

/**
 * Les manœuvres de TomTom, ramenées au geste qu'elles décrivent.
 *
 * Le test se fait sur des fragments et non sur une table exhaustive : l'API en
 * publie une cinquantaine et en ajoute au fil des versions, et une valeur
 * inconnue doit devenir « continuez » plutôt que de faire disparaître
 * l'instruction.
 */
function tomtomManeuver(raw: string): CarManeuverKind {
  if (raw.startsWith("DEPART")) return "depart";
  if (raw.startsWith("ARRIVE")) return "arrive";
  if (raw.startsWith("WAYPOINT")) return "waypoint";
  if (raw.includes("ROUNDABOUT")) return "roundabout";
  if (raw.includes("UTURN")) return "uturn";
  // L'ordre compte : `EXIT_ROUNDABOUT` est déjà parti plus haut, et
  // `ENTER_MOTORWAY` ne doit pas être pris pour une sortie.
  if (raw.startsWith("EXIT_")) return "exitMotorway";
  if (raw.startsWith("ENTER_")) return "enterMotorway";
  if (raw.startsWith("MERGE")) return "merge";
  if (raw.startsWith("BEAR") || raw.startsWith("FORK")) return "fork";
  if (raw.startsWith("KEEP_LEFT")) return "keepLeft";
  if (raw.startsWith("KEEP_RIGHT")) return "keepRight";
  if (raw.startsWith("SHARP_LEFT")) return "sharpLeft";
  if (raw.startsWith("SHARP_RIGHT")) return "sharpRight";
  if (raw.startsWith("TURN_LEFT")) return "left";
  if (raw.startsWith("TURN_RIGHT")) return "right";
  if (raw.includes("SLIGHT_LEFT")) return "slightLeft";
  if (raw.includes("SLIGHT_RIGHT")) return "slightRight";
  if (raw.includes("LEFT")) return "left";
  if (raw.includes("RIGHT")) return "right";
  return "straight";
}

// ---------------------------------------------------------------------------
// OSRM — le repli sans clé
// ---------------------------------------------------------------------------

interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  geometry: GeoJSON.LineString;
  maneuver: { type: string; modifier?: string; exit?: number; location: [number, number] };
}

interface OsrmResponse {
  code: string;
  routes: Array<{
    distance: number;
    duration: number;
    legs: Array<{ steps: OsrmStep[] }>;
  }>;
}

/**
 * Le même OSRM que le panneau d'itinéraire, avec les manœuvres.
 *
 * Il ne sait rien du trafic ni des péages, et `avoidTolls` n'a donc **aucun**
 * moyen d'être honoré : plutôt que de rendre le même trajet sous une étiquette
 * mensongère, l'écran de choix ne propose qu'un seul itinéraire quand la clé
 * manque, et le dit.
 */
async function fetchOsrm(points: LonLat[], options: CarRouteOptions): Promise<CarRoute> {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  // Le sens de marche, pour le seul point de départ : OSRM accroche alors la
  // position à la chaussée orientée dans ce sens (±60°), les autres points
  // restent libres.
  const bearings =
    options.heading != null
      ? `&bearings=${points.map((_, i) => (i === 0 ? `${headingParam(options.heading as number)},60` : "")).join(";")}`
      : "";
  const url =
    `${CONFIG.OSRM_ROUTING.driving}/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&steps=true${bearings}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: options.signal });
  } catch (error) {
    // Une annulation n'est pas une panne de réseau : elle remonte telle quelle.
    if (options.signal?.aborted) throw error;
    throw new Error(navText("nav.errorOffline"));
  }
  if (!res.ok) throw new Error(navText("car.errorService", { status: String(res.status) }));
  const data: OsrmResponse = await res.json();
  if (data.code !== "Ok" || !data.routes.length) throw new Error(navText("car.errorNoRoute"));
  const route = data.routes[0];

  const routePoints: LonLat[] = [];
  const measures: number[] = [];
  const steps: CarStep[] = [];
  let traveled = 0;
  let elapsed = 0;

  route.legs.forEach((leg) => {
    leg.steps.forEach((step) => {
      steps.push({
        maneuver: {
          kind: osrmManeuver(step.maneuver.type, step.maneuver.modifier),
          street: step.name ?? "",
          road: step.ref ?? "",
          exit: step.maneuver.exit ?? null,
          waypoint: null,
        },
        atMeters: traveled,
        atSeconds: elapsed,
        location: { lon: step.maneuver.location[0], lat: step.maneuver.location[1] },
      });
      elapsed += step.duration;
      for (const [lon, lat] of step.geometry.coordinates) {
        const point = { lon, lat };
        const previous = routePoints[routePoints.length - 1];
        // Deux étapes partagent leur point de jonction ; ici rien n'oblige à le
        // garder en double, aucun index de section ne s'appuie dessus.
        if (previous && previous.lon === lon && previous.lat === lat) continue;
        if (previous) traveled += distance(previous, point);
        routePoints.push(point);
        measures.push(traveled);
      }
    });
  });

  if (routePoints.length < 2 || steps.length < 2) throw new Error(navText("car.errorNoRoute"));
  numberWaypoints(steps);

  return {
    points: routePoints,
    measures,
    steps,
    lanes: [],
    speedZones: [],
    tollSections: [],
    traffic: [],
    distanceMeters: traveled,
    durationSeconds: route.duration,
    trafficDelaySeconds: null,
    live: false,
    result: asResult(routePoints, traveled, route.duration),
  };
}

function osrmManeuver(type: string, modifier?: string): CarManeuverKind {
  if (type === "depart") return "depart";
  if (type === "arrive") return "arrive";
  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") return "roundabout";
  if (type === "merge") return "merge";
  if (type === "fork") return "fork";
  if (type === "on ramp") return "enterMotorway";
  if (type === "off ramp") return "exitMotorway";

  switch (modifier) {
    case "uturn":
      return "uturn";
    case "sharp left":
      return "sharpLeft";
    case "sharp right":
      return "sharpRight";
    case "slight left":
      return type === "continue" ? "keepLeft" : "slightLeft";
    case "slight right":
      return type === "continue" ? "keepRight" : "slightRight";
    case "left":
      return "left";
    case "right":
      return "right";
    default:
      return "straight";
  }
}

// ---------------------------------------------------------------------------
// Commun aux deux moteurs
// ---------------------------------------------------------------------------

/**
 * Donne son rang à chaque arrivée intermédiaire.
 *
 * Les deux moteurs signalent le passage par une étape — `WAYPOINT_*` chez
 * TomTom, une arrivée de tronçon chez OSRM — mais aucun ne le numérote. C'est
 * ce rang qui permet d'annoncer « Étape 2 atteinte » plutôt qu'une arrivée qui
 * n'en est pas une, et à un recalcul de savoir combien d'étapes sont déjà
 * derrière.
 */
function numberWaypoints(steps: CarStep[]): void {
  let rank = 0;
  steps.forEach((step, index) => {
    const intermediate =
      step.maneuver.kind === "waypoint" ||
      (step.maneuver.kind === "arrive" && index < steps.length - 1);
    if (!intermediate) return;
    rank += 1;
    step.maneuver = { ...step.maneuver, kind: "waypoint", waypoint: rank };
  });
}

function asResult(points: LonLat[], meters: number, seconds: number): RouteResult {
  return {
    mode: "driving",
    distanceMeters: meters,
    durationSeconds: seconds,
    segments: [
      {
        geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) },
        color: ROUTE_COLOR,
        dashed: false,
      },
    ],
  };
}

/**
 * Réduit une liste de points à `count` au plus, en gardant les deux extrémités.
 *
 * Un échantillonnage régulier suffit ici : les points d'appui ne servent qu'à
 * dire au moteur quel chemin on suit, pas à le décrire au mètre.
 */
function sample(points: LonLat[], count: number): LonLat[] {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  const out: LonLat[] = [];
  for (let i = 0; i < count; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** La vitesse autorisée à cet endroit du parcours, `null` si la source l'ignore. */
export function speedLimitAt(route: CarRoute, atMeters: number): number | null {
  // Recherche dichotomique : la liste est triée et relue à chaque relevé.
  let low = 0;
  let high = route.speedZones.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const zone = route.speedZones[middle];
    if (atMeters < zone.fromMeters) high = middle - 1;
    else if (atMeters > zone.toMeters) low = middle + 1;
    else return zone.kmh;
  }
  return null;
}

/** Le conseil de file en vigueur à cet endroit, `null` s'il n'y en a pas. */
export function lanesAt(route: CarRoute, atMeters: number, aheadMeters: number): LaneAdvice | null {
  for (const advice of route.lanes) {
    // Les voies sont annoncées **avant** d'y arriver : une section de voies ne
    // couvre que le carrefour lui-même, et l'y afficher seulement serait
    // l'afficher une fois qu'il est trop tard pour changer de file.
    if (atMeters >= advice.fromMeters - aheadMeters && atMeters <= advice.toMeters) return advice;
  }
  return null;
}
