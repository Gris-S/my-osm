import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  MapPin,
  Merge,
  RotateCcw,
  Split,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { NavManeuver } from "./route";
import { navText } from "./strings";

// ---------------------------------------------------------------------------
// De la manœuvre brute d'OSRM à ce qu'on montre : une phrase et un pictogramme.
//
// La traduction se fait **ici et au rendu**, pas au calcul : le trajet garde
// les champs bruts d'OSRM (voir `route.ts`), ce qui permet à un changement de
// langue de redessiner l'instruction en cours au lieu de la laisser dans
// l'ancienne — la même règle que pour les relevés météo du projet.
// ---------------------------------------------------------------------------

/** Le pan vers lequel une manœuvre fait tourner, indépendamment de sa forme. */
type Side = "left" | "right" | "straight" | "uturn";

function sideOf(modifier: string | undefined): Side {
  if (!modifier) return "straight";
  if (modifier === "uturn") return "uturn";
  if (modifier.includes("left")) return "left";
  if (modifier.includes("right")) return "right";
  return "straight";
}

/**
 * Le pictogramme d'une manœuvre. Les virages francs prennent la flèche à angle
 * droit, les inflexions la flèche oblique : à distance, c'est la forme du
 * dessin qui se lit, pas son étiquette.
 */
export function maneuverIcon(maneuver: NavManeuver): LucideIcon {
  const { type, modifier } = maneuver;
  if (type === "arrive") return maneuver.waypoint === null ? Flag : MapPin;
  if (type === "depart") return ArrowUp;
  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") return RotateCcw;
  if (type === "merge") return Merge;
  if (type === "fork") return Split;

  switch (modifier) {
    case "uturn":
      return Undo2;
    case "sharp left":
    case "left":
      return CornerUpLeft;
    case "sharp right":
    case "right":
      return CornerUpRight;
    case "slight left":
      return ArrowUpLeft;
    case "slight right":
      return ArrowUpRight;
    default:
      return ArrowUp;
  }
}

/**
 * La phrase d'une manœuvre. Chaque tournant a deux formulations, selon que la
 * voie où l'on arrive porte un nom ou non : « Tournez à droite rue de Rivoli »
 * quand OSRM le connaît, « Tournez à droite » quand le chemin est anonyme —
 * c'est fréquent à pied, où l'on emprunte des passages sans nom.
 */
export function maneuverText(maneuver: NavManeuver): string {
  const { type, modifier, name, exit, waypoint } = maneuver;
  const named = name.length > 0;
  const vars = { name, exit: exit ?? 0 };

  if (type === "arrive") {
    if (waypoint !== null) return navText("step.waypoint", { index: waypoint });
    return named ? navText("step.arriveNamed", vars) : navText("step.arrive");
  }
  if (type === "depart") return named ? navText("step.departNamed", vars) : navText("step.depart");

  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") {
    if (exit === 1) {
      return named ? navText("step.roundaboutFirstNamed", vars) : navText("step.roundaboutFirst");
    }
    if (exit && exit > 1) {
      return named ? navText("step.roundaboutExitNamed", vars) : navText("step.roundaboutExit", vars);
    }
    return named ? navText("step.roundaboutNamed", vars) : navText("step.roundabout");
  }

  switch (modifier) {
    case "uturn":
      return named ? navText("step.uturnNamed", vars) : navText("step.uturn");
    case "sharp left":
      return named ? navText("step.sharpLeftNamed", vars) : navText("step.sharpLeft");
    case "sharp right":
      return named ? navText("step.sharpRightNamed", vars) : navText("step.sharpRight");
    case "slight left":
      return named ? navText("step.slightLeftNamed", vars) : navText("step.slightLeft");
    case "slight right":
      return named ? navText("step.slightRightNamed", vars) : navText("step.slightRight");
    case "left":
      return named ? navText("step.leftNamed", vars) : navText("step.left");
    case "right":
      return named ? navText("step.rightNamed", vars) : navText("step.right");
    default:
      // « Continuez » couvre `continue`, `new name` et `notification` : à pied,
      // la différence entre changer de nom de rue et poursuivre tout droit
      // n'existe pas pour celui qui marche.
      return named ? navText("step.continueNamed", vars) : navText("step.continue");
  }
}

/** Vers où penche la manœuvre : sert à la teinter dans le bandeau. */
export function maneuverSide(maneuver: NavManeuver): Side {
  return sideOf(maneuver.modifier);
}
