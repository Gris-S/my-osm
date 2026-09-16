import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  MapPin,
  Merge,
  Milestone,
  RotateCcw,
  Split,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { navText } from "../strings";
import type { CarManeuver } from "./carRoute";

// ---------------------------------------------------------------------------
// De la manœuvre brute à ce qui s'affiche : un pictogramme, une action, une
// direction.
//
// Le bandeau du haut porte trois choses dans cet ordre : **la distance, ce
// qu'il faut faire, et où l'on va**. La troisième est celle qu'on oublie le
// plus souvent et c'est pourtant elle qui compte sur autoroute : « à 800 m,
// sortie à droite » ne dit rien, « à 800 m, sortie à droite → A6 Lyon » dit
// tout. D'où la séparation entre `maneuverAction` et `maneuverDirection` — la
// première est le geste, la seconde la route ou la rue où il mène.
//
// Comme pour la marche, la traduction se fait **au rendu** et non au calcul :
// le trajet garde les champs bruts, et changer de langue redessine
// l'instruction en cours au lieu de la laisser dans l'ancienne.
// ---------------------------------------------------------------------------

/** Le pan vers lequel penche la manœuvre : sert à la teinter dans le bandeau. */
export type ManeuverSide = "left" | "right" | "straight" | "uturn";

export function carManeuverSide(maneuver: CarManeuver): ManeuverSide {
  switch (maneuver.kind) {
    case "left":
    case "slightLeft":
    case "sharpLeft":
    case "keepLeft":
      return "left";
    case "right":
    case "slightRight":
    case "sharpRight":
    case "keepRight":
    case "exitMotorway":
      return "right";
    case "uturn":
      return "uturn";
    default:
      return "straight";
  }
}

/**
 * Le pictogramme. Les virages francs prennent la flèche à angle droit, les
 * inflexions et les changements de file la flèche oblique : au volant, c'est la
 * forme du dessin qu'on lit du coin de l'œil, jamais son étiquette.
 */
/**
 * Le numéro de sortie à inscrire dans le pictogramme, ou `null`. Seuls les
 * ronds-points en portent un — voir `roundaboutExit` côté piéton.
 */
export function carRoundaboutExit(maneuver: CarManeuver): number | null {
  if (maneuver.kind !== "roundabout") return null;
  return maneuver.exit && maneuver.exit > 0 ? maneuver.exit : null;
}

export function carManeuverIcon(maneuver: CarManeuver): LucideIcon {
  switch (maneuver.kind) {
    case "depart":
      return ArrowUp;
    case "arrive":
      return Flag;
    case "waypoint":
      return MapPin;
    case "roundabout":
      return RotateCcw;
    case "merge":
      return Merge;
    case "fork":
      return Split;
    case "enterMotorway":
      return Milestone;
    case "exitMotorway":
      return ArrowUpRight;
    case "uturn":
      return Undo2;
    case "left":
    case "sharpLeft":
      return CornerUpLeft;
    case "right":
    case "sharpRight":
      return CornerUpRight;
    case "slightLeft":
    case "keepLeft":
      return ArrowUpLeft;
    case "slightRight":
    case "keepRight":
      return ArrowUpRight;
    default:
      return ArrowUp;
  }
}

/**
 * Le geste à faire, sans le nom de la route.
 *
 * Il n'y a donc **pas** de variante « …Named » ici, contrairement au guidage
 * piéton : la destination est écrite en dessous, sur sa propre ligne, où elle
 * peut prendre la place qu'il faut sans allonger l'action. Un conducteur lit
 * l'action d'un coup d'œil et la direction d'un second ; les fondre en une
 * phrase oblige à lire toute la ligne pour savoir s'il faut tourner.
 */
export function carManeuverAction(maneuver: CarManeuver): string {
  switch (maneuver.kind) {
    case "depart":
      return navText("car.depart");
    case "arrive":
      return navText("car.arrive");
    case "waypoint":
      return navText("car.waypoint", { index: maneuver.waypoint ?? 1 });
    case "roundabout":
      return maneuver.exit
        ? navText("car.roundaboutExit", { exit: maneuver.exit })
        : navText("car.roundabout");
    case "merge":
      return navText("car.merge");
    case "fork":
      return navText("car.fork");
    case "enterMotorway":
      return navText("car.enterMotorway");
    case "exitMotorway":
      return maneuver.exit
        ? navText("car.exitNumbered", { exit: maneuver.exit })
        : navText("car.exit");
    case "uturn":
      return navText("car.uturn");
    case "left":
      return navText("car.left");
    case "right":
      return navText("car.right");
    case "sharpLeft":
      return navText("car.sharpLeft");
    case "sharpRight":
      return navText("car.sharpRight");
    case "slightLeft":
      return navText("car.slightLeft");
    case "slightRight":
      return navText("car.slightRight");
    case "keepLeft":
      return navText("car.keepLeft");
    case "keepRight":
      return navText("car.keepRight");
    default:
      return navText("car.straight");
  }
}

/**
 * Où la manœuvre mène, en deux morceaux : le **numéro de route** et le **nom de
 * la voie**.
 *
 * Les deux sont séparés parce qu'ils ne se lisent pas de la même façon et n'ont
 * pas la même valeur au volant. Le numéro est ce qu'on cherche sur les
 * panneaux — « A6 », « D906 » — et il se reconnaît à sa forme et à sa couleur,
 * d'un coup d'œil, sans être lu. Le nom de la rue, lui, se lit vraiment, et
 * seulement quand on en a besoin. Les fondre en une seule chaîne, comme c'était
 * fait, obligeait à parcourir toute la ligne pour trouver le numéro.
 *
 * La déduplication reste nécessaire : les deux moteurs répètent parfois le
 * numéro dans le nom de la voie (« Rue Nationale/D906 »).
 */
export function carManeuverRoad(maneuver: CarManeuver): { road: string; street: string } {
  const road = maneuver.road.trim();
  const street = maneuver.street.trim();
  if (!road) return { road: "", street };
  // Le nom qui n'est que le numéro, ou qui le contient déjà, n'apprend rien de
  // plus : l'écrire à côté de la pastille ferait lire deux fois la même chose.
  if (!street || street === road || street.includes(road)) return { road, street: "" };
  return { road, street };
}

/**
 * La famille d'une route, d'après son numéro. Elle décide de la couleur de la
 * pastille.
 *
 * Les couleurs ne sont pas inventées : ce sont celles des **bornes routières
 * françaises**, que tout conducteur a déjà vues au bord de la chaussée.
 *
 *   rouge      autoroutes (A) et routes nationales (N)
 *   jaune      routes départementales (D)
 *   blanc      voies communales (C) et rurales (R)
 *   vert       routes européennes (E) et forestières (F)
 *   bleu cyan  réseaux métropolitains (M)
 *
 * D'où deux regroupements qui surprennent si l'on raisonne en importance plutôt
 * qu'en signalisation : **l'autoroute et la nationale partagent le rouge**, et
 * **l'européenne partage le vert avec la forestière**. C'est voulu — la pastille
 * sert à reconnaître une route, pas à la hiérarchiser, et reproduire une
 * convention que l'œil connaît déjà vaut mieux que d'en fabriquer une.
 *
 * Le classement se fait sur la **lettre initiale**, seule partie stable : les
 * numéros s'écrivent `A6`, `A 6`, `D906`, `E15`, `M108k`.
 */
export type RoadClass =
  /** Rouge : autoroute (A) ou nationale (N). */
  | "national"
  /** Jaune : départementale (D). */
  | "departmental"
  /** Blanc : voie communale (C) ou rurale (R). */
  | "communal"
  /** Vert : route européenne (E) ou forestière (F). */
  | "european"
  /** Bleu cyan : réseau métropolitain (M) — la métropole de Lyon, par exemple,
   *  a rebaptisé ainsi ses anciennes départementales. */
  | "metropolitan"
  | "other";

export function roadClass(road: string): RoadClass {
  switch (road.trim().charAt(0).toUpperCase()) {
    case "A":
    case "N":
      return "national";
    case "D":
      return "departmental";
    case "C":
    case "R":
      return "communal";
    case "E":
    case "F":
      return "european";
    case "M":
      return "metropolitan";
    default:
      return "other";
  }
}
