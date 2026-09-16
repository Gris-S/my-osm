import { Camera, Crosshair, LoaderCircle, Play, Square, X } from "lucide-react";
import { formatDistance } from "../../utils/format";
import { useNavDockRef } from "../dockClearance";
import { MusicCard } from "../music/MusicCard";
import { formatClock, formatGuidanceDistance, splitDuration, useNav } from "../strings";
import {
  carManeuverAction,
  carManeuverIcon,
  carManeuverRoad,
  carManeuverSide,
  carRoundaboutExit,
  roadClass,
} from "./carManeuver";
import { isOffRoute } from "./carProgress";
import { lanesAt, type LaneAdvice } from "./carRoute";
import { RouteChoice } from "./RouteChoice";
import type { CarNavSession, RadarAlert, SpeedState } from "./useCarNavigation";

// ---------------------------------------------------------------------------
// Ce qu'on a sous les yeux en conduisant.
//
// Trois zones, et pas une de plus, parce qu'au volant on ne lit pas : on
// reconnaît.
//
//   en haut       distance — action — direction, et la file à prendre dessous
//   à gauche      la vitesse, qui change de couleur au-delà de la limite
//   en bas        l'heure d'arrivée en gros, le temps restant à côté
//
// L'ordre du bandeau n'est pas indifférent. **La distance d'abord** : c'est
// elle qui dit si la manœuvre est pour tout de suite ou pour dans dix minutes,
// et donc s'il faut s'en occuper. L'action ensuite. La direction en dessous, sur
// sa propre ligne — « A6 Lyon », « Sortie 12 » — parce que sur autoroute
// « serrez à droite » ne veut rien dire sans elle, et qu'une seule ligne
// obligerait à lire jusqu'au bout pour savoir s'il faut tourner.
//
// En bas, **l'heure d'arrivée est le gros chiffre**, à l'inverse du guidage
// piéton où c'est le temps restant. Sur un trajet de vingt minutes on compte en
// minutes ; sur quatre heures de route, c'est « j'arrive à 17 h 40 » qu'on
// retient, qu'on annonce au téléphone et qu'on surveille.
// ---------------------------------------------------------------------------

/**
 * À quelle distance de la manœuvre les files sont annoncées.
 *
 * Trois cents mètres : sur autoroute, c'est le panneau d'affectation de voies,
 * et en ville le temps de deux feux. Plus tôt, l'indication reste affichée si
 * longtemps qu'on ne sait plus à quel carrefour elle se rapporte.
 */
const LANES_AHEAD = 300;

/** « 13 min », « 1h20 » : le temps restant d'un bloc, unité comprise. */
function remainingText(seconds: number): string {
  const { value, unit } = splitDuration(seconds);
  return unit ? `${value} ${unit}` : value;
}

export function CarNavigationPanel({ session }: { session: CarNavSession }) {
  const { nav } = useNav();
  // Hauteur de la colonne du bas, lue par `App` pour y ranger les boutons de droite.
  const dockRef = useNavDockRef();
  const { progress, route, status, eta } = session;

  if (!session.active) return null;
  // Tant que l'on choisit, seule la fenêtre de choix est à l'écran : le bandeau
  // de guidage annoncerait des manœuvres d'un trajet qu'on n'a pas retenu.
  if (status === "choosing") return <RouteChoice session={session} />;

  const next = progress?.next ?? null;
  const arrived = status === "arrived";
  const advice =
    route && progress && next ? lanesAt(route, progress.traveledMeters, LANES_AHEAD) : null;

  return (
    <>
      <div className="nav-banner car-banner">
        {arrived ? (
          <div className="nav-maneuver is-arrival">
            <span className="nav-maneuver-icon is-arrival">
              <Crosshair size={30} />
            </span>
            <div className="nav-maneuver-text">
              <span className="nav-maneuver-instruction">
                {session.destinationName
                  ? nav("car.arrivedAt", { name: session.destinationName })
                  : nav("car.arrived")}
              </span>
            </div>
          </div>
        ) : next ? (
          <Maneuver
            distanceMeters={next.distanceMeters}
            action={carManeuverAction(next.step.maneuver)}
            {...carManeuverRoad(next.step.maneuver)}
            Icon={carManeuverIcon(next.step.maneuver)}
            side={carManeuverSide(next.step.maneuver)}
            exit={carRoundaboutExit(next.step.maneuver)}
            then={
              progress?.then
                ? {
                    action: carManeuverAction(progress.then.maneuver),
                    Icon: carManeuverIcon(progress.then.maneuver),
                  }
                : null
            }
          />
        ) : (
          <p className="nav-banner-waiting">
            <LoaderCircle size={16} className="nav-spin" />
            {status === "computing"
              ? nav("car.computing")
              : session.error
                ? session.error
                : nav("car.locating")}
          </p>
        )}

        {/* Les files se posent **sous** le bandeau et non dedans : elles ne
            concernent qu'une manœuvre sur dix, et leur réserver une place
            permanente aurait rétréci l'instruction pour rien. */}
        {advice && !arrived && <Lanes advice={advice} />}

        {/* Un changement d'itinéraire dû au trafic se **dit**, et dit ce qu'il
            rapporte : sans cela, voir le tracé bouger tout seul passerait pour
            une erreur de l'application plutôt que pour son travail. */}
        {session.trafficGainSeconds !== null && !arrived && (
          <p className="nav-banner-note is-traffic">
            {nav("car.trafficRerouted", {
              minutes: Math.max(1, Math.round(session.trafficGainSeconds / 60)),
            })}
          </p>
        )}
        {session.rerouting && <p className="nav-banner-note">{nav("car.rerouting")}</p>}
        {!session.rerouting && progress && isOffRoute(progress) && !arrived && (
          <p className="nav-banner-note">{nav("car.offRoute")}</p>
        )}
      </div>

      {/* Le compteur est à gauche, à l'opposé du volant et dans le champ de
          vision du conducteur quand la carte occupe le centre. */}
      <Speedometer speed={session.speed} />

      {session.alert && <RadarBanner alert={session.alert} />}

      <div className="nav-dock" ref={dockRef}>
        {!session.follow && (
          <button className="nav-recenter" onClick={session.recenter}>
            <Crosshair size={15} />
            {nav("car.recenter")}
          </button>
        )}

        {/* Musique en cours : l'encart n'existe que s'il y en a une (voir `music/`). */}
        <MusicCard />
        <div className="nav-bar car-bar">
          <div className="nav-bar-main">
            <div className="car-figures">
              {/* L'heure d'arrivée en gros : c'est elle qu'on retient et qu'on
                  annonce. Le temps restant et la distance la complètent.

                  Les deux viennent de `session.eta` et **non** de `progress` :
                  celui-ci ignore le trafic apparu depuis le calcul du trajet, et
                  annoncerait une arrivée qu'on sait déjà fausse. */}
              <span className="car-arrival" title={nav("car.arrivalAt")}>
                {eta ? formatClock(eta.arrivalAt) : "—"}
              </span>
              {/* Temps restant et distance sur **une** ligne, au même corps et
                  unités comprises : l'unité en petit sous le chiffre, et la
                  distance repliée sur deux lignes faute de place, faisaient
                  une barre dépareillée. */}
              <span className="car-side">
                <span className="car-remaining" title={nav("car.remaining")}>
                  {eta ? remainingText(eta.remainingSeconds) : "—"}
                </span>
                <span className="car-dot" aria-hidden="true">
                  ·
                </span>
                <span className="car-distance" title={nav("car.distance")}>
                  {progress ? formatDistance(progress.remainingMeters) : "—"}
                </span>
              </span>
            </div>

            {import.meta.env.DEV && route && (
              <button
                className={`nav-sim ${session.simulating ? "is-on" : ""}`}
                onClick={session.toggleSimulation}
                aria-label={session.simulating ? nav("sim.stopDrive") : nav("sim.startDrive")}
                title={session.simulating ? nav("sim.stopDrive") : nav("sim.startDrive")}
              >
                {session.simulating ? <Square size={14} /> : <Play size={14} />}
              </button>
            )}

            {/* Un rond rouge et une croix, sans libellé : il ne prend plus de
                place à l'heure d'arrivée, qui se centre sur toute la barre. Le
                libellé reste pour la synthèse vocale et l'infobulle. */}
            <button className="nav-stop" onClick={session.stop} aria-label={nav("car.stop")} title={nav("car.stop")}>
              <X size={22} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Maneuver({
  distanceMeters,
  action,
  road,
  street,
  Icon,
  side,
  exit,
  then,
}: {
  distanceMeters: number;
  action: string;
  road: string;
  street: string;
  Icon: React.ComponentType<{ size?: number }>;
  side: "left" | "right" | "straight" | "uturn";
  /** Numéro de sortie d'un rond-point, inscrit dans le pictogramme. */
  exit: number | null;
  then: { action: string; Icon: React.ComponentType<{ size?: number }> } | null;
}) {
  const { nav } = useNav();
  return (
    <div className="nav-maneuver car-maneuver">
      <span className={`nav-maneuver-icon is-${side}`}>
        <Icon size={44} />
        {exit !== null && <span className="nav-exit">{exit}</span>}
      </span>
      <div className="nav-maneuver-text">
        <span className="car-maneuver-line">
          <span className="nav-maneuver-distance">{formatGuidanceDistance(distanceMeters)}</span>
          <span className="car-maneuver-action">{action}</span>
        </span>
        {/* La direction ne s'affiche que si la source la nomme : en ville, les
            rues des manœuvres sont souvent anonymes, et une ligne vide décalerait
            le bandeau à chaque carrefour.

            Le numéro de route et le nom de la voie sont deux objets distincts et
            non une phrase : le premier est une pastille, large et colorée, qu'on
            reconnaît sans la lire ; le second se lit, et seulement si l'on veut. */}
        {(road || street) && (
          <span className="car-maneuver-direction">
            {road && <RoadShield road={road} />}
            {street && <span className="car-maneuver-street">{street}</span>}
          </span>
        )}
        {/* La manœuvre d'après n'est annoncée que lorsque celle-ci est proche :
            deux enchaînées se préparent ensemble — « à droite, puis à gauche »
            — mais à trois kilomètres elle n'apprendrait rien. */}
        {then && distanceMeters < 400 && (
          <span className="car-maneuver-then">
            {nav("car.then")}
            <then.Icon size={13} />
            {then.action}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Le numéro de route, en pastille.
 *
 * Elle est **grande** — plus grande que le nom de la rue, qui est pourtant une
 * phrase — parce que c'est elle qu'on cherche, et de loin : sur un panneau
 * d'autoroute on repère « A6 » avant d'avoir lu quoi que ce soit. Un nom de rue
 * ne se repère pas, il se lit, et il n'a donc pas besoin de grandir.
 *
 * La couleur dit la famille de la route d'un seul regard, et c'est celle des
 * **bornes routières françaises** : rouge pour les autoroutes et les
 * nationales, jaune pour les départementales, blanc pour les voies communales
 * et rurales, vert pour les européennes et les forestières, bleu cyan pour les
 * réseaux métropolitains. Reprendre une convention que l'œil connaît déjà vaut
 * mieux que d'en fabriquer une (voir `roadClass`).
 */
function RoadShield({ road }: { road: string }) {
  return <span className={`car-road is-${roadClass(road)}`}>{road}</span>;
}

/**
 * Les files, dessinées comme une chaussée vue de face.
 *
 * Les voies qui mènent où l'on va sont pleines, les autres effacées : c'est la
 * source elle-même qui les désigne (`follow`), sans déduction de notre part. On
 * ne dit pas « mettez-vous à droite », on montre la chaussée telle qu'elle se
 * présentera — c'est ce qu'on reconnaît en arrivant dessus.
 */
function Lanes({ advice }: { advice: LaneAdvice }) {
  const { nav } = useNav();
  return (
    <div className="car-lanes" role="img" aria-label={nav("car.lanes")}>
      {advice.lanes.map((lane, index) => (
        <span key={index} className={`car-lane ${lane.follow ? "is-follow" : ""}`}>
          <svg viewBox={LANE_VIEWBOX} className="car-lane-arrow" aria-hidden="true">
            {/* Toutes les directions de la voie, superposées comme sur un
                panneau : une voie « tout droit ou à droite » porte les deux. */}
            {laneDirections(lane.directions).map((direction) => (
              <path key={direction} d={LANE_ARROWS[direction]} />
            ))}
          </svg>
        </span>
      ))}
    </div>
  );
}

/**
 * Les flèches de voie, dessinées.
 *
 * Elles étaient des caractères (`↑`, `↖`, `↰`), ce qui avait l'avantage de ne
 * rien coûter — et deux défauts qui se sont révélés à l'usage. Un caractère est
 * **carré** : impossible d'allonger la hampe sans déformer la pointe, alors
 * qu'un panneau d'affectation de voies tire justement ses flèches en hauteur.
 * Et son dessin dépend de la fonte de l'appareil, donc de l'appareil.
 *
 * Les tracés ci-dessous sont donc engendrés par un petit calcul de géométrie :
 * une hampe polygonale, et une pointe posée perpendiculairement au dernier
 * segment — ce qui garantit que le chevron reste d'équerre quelle que soit
 * l'inclinaison de la flèche, y compris sur les demi-tours.
 *
 * **La boîte fait 40 × 60.** Dans l'ancienne, large de 28, le bras de « à
 * droite » ne dépassait la hampe que de 8,5 unités et son chevron revenait
 * derrière elle : une hampe à crochet, pas une flèche (constaté sur une
 * capture). La case de 46 px laissait la place. Les virages partent bas sur la
 * hampe, sous la pointe de « tout droit », pour qu'une voie à deux directions
 * se lise sans que les pointes se touchent ; virages serrés et demi-tours ont
 * leur hampe décalée, pour que le bras qui redescend passe loin d'elle.
 *
 * Les clés sont **celles de TomTom**, vérifiées sur l'API — dont `LEFT_U_TURN`
 * et `RIGHT_U_TURN` : la table attendait `UTURN`, jamais envoyé, et une voie de
 * demi-tour se dessinait tout droit.
 */
const LANE_VIEWBOX = "0 0 40 60";

const LANE_ARROWS: Record<string, string> = {
  STRAIGHT: "M20.0 57.0L20.0 5.0 M27.4 14.5L20.0 5.0L12.6 14.5",
  SLIGHT_RIGHT: "M20.0 57.0L20.0 38.0L33.0 16.0 M34.5 27.9L33.0 16.0L21.8 20.4",
  RIGHT: "M20.0 57.0L20.0 32.0L35.0 32.0 M25.5 39.4L35.0 32.0L25.5 24.6",
  SHARP_RIGHT: "M12.0 57.0L12.0 16.0L34.0 42.0 M22.3 39.6L34.0 42.0L33.5 30.0",
  RIGHT_U_TURN: "M13.0 57.0L13.0 14.0L29.0 14.0L29.0 40.0 M21.6 30.5L29.0 40.0L36.4 30.5",
  SLIGHT_LEFT: "M20.0 57.0L20.0 38.0L7.0 16.0 M18.2 20.4L7.0 16.0L5.5 27.9",
  LEFT: "M20.0 57.0L20.0 32.0L5.0 32.0 M14.5 24.6L5.0 32.0L14.5 39.4",
  SHARP_LEFT: "M28.0 57.0L28.0 16.0L6.0 42.0 M6.5 30.0L6.0 42.0L17.7 39.6",
  LEFT_U_TURN: "M27.0 57.0L27.0 14.0L11.0 14.0L11.0 40.0 M3.6 30.5L11.0 40.0L18.4 30.5",
};

/**
 * Les directions à tracer pour une voie : celles qu'on sait dessiner, sans
 * doublon, et « tout droit » si aucune ne l'est — une direction inconnue ne
 * doit pas laisser une case vide.
 */
function laneDirections(directions: string[]): string[] {
  const known = [...new Set(directions)].filter((direction) => direction in LANE_ARROWS);
  return known.length ? known : ["STRAIGHT"];
}

/**
 * Le compteur.
 *
 * La vitesse relevée en gros, la limite en pastille à côté quand la source la
 * publie — et tout le bloc vire au rouge au-delà. La couleur est portée par le
 * **fond** et non par le seul chiffre : un chiffre rouge sur fond clair se
 * repère mal du coin de l'œil, ce qui est précisément la façon dont on regarde
 * son compteur.
 */
function Speedometer({ speed }: { speed: SpeedState }) {
  const { nav } = useNav();
  if (speed.kmh === null) return null;
  return (
    <div
      className={`car-speed ${speed.over ? "is-over" : ""} ${speed.stale ? "is-stale" : ""}`}
      // Un chiffre qui n'est plus rafraîchi doit se voir comme tel : il pâlit,
      // et la synthèse vocale le dit. Le laisser identique à un relevé frais
      // ferait passer la dernière vitesse connue pour la vitesse actuelle.
      title={speed.stale ? nav("car.speedStale") : undefined}
    >
      <span className="car-speed-value">{speed.kmh}</span>
      <span className="car-speed-unit">{nav("car.kmh")}</span>
      {speed.limitKmh !== null && (
        <span className="car-speed-limit" title={nav("car.limit")}>
          {speed.limitKmh}
        </span>
      )}
    </div>
  );
}

/**
 * L'avertissement de radar.
 *
 * C'est la **seule** chose de l'application qui fasse du bruit — deux notes
 * brèves, une fois par radar (voir `radars.ts`). L'encart visuel l'accompagne et
 * reste tant qu'on n'a pas dépassé le radar : le son dit qu'il se passe quelque
 * chose, l'encart dit quoi, et à quelle distance.
 */
function RadarBanner({ alert }: { alert: RadarAlert }) {
  const { nav } = useNav();
  return (
    <div className="car-radar" role="status">
      <Camera size={18} />
      <span className="car-radar-text">
        <strong>{nav(RADAR_LABELS[alert.radar.kind])}</strong>
        <span>
          {formatGuidanceDistance(alert.distanceMeters)}
          {alert.radar.kmh !== null && ` · ${alert.radar.kmh} ${nav("car.kmh")}`}
        </span>
      </span>
    </div>
  );
}

const RADAR_LABELS = {
  fixed: "car.radarFixed",
  tower: "car.radarTower",
  average: "car.radarAverage",
  light: "car.radarLight",
  crossing: "car.radarCrossing",
} as const;
