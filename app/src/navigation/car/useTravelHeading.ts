import { useCallback, useEffect, useRef } from "react";
import { bearing, distance } from "../geo";
import type { NavFix } from "../useNavPosition";

// ---------------------------------------------------------------------------
// Le sens de marche : le cap GPS quand la vitesse le rend fiable, sinon la
// direction du déplacement entre deux relevés assez éloignés. Il accompagne
// chaque calcul d'itinéraire (`vehicleHeading`). Sorti de `useCarNavigation`.
// ---------------------------------------------------------------------------

/**
 * En dessous de cette vitesse, le cap de l'appareil n'est pas fiable. Plus haut
 * qu'à pied : une voiture à l'arrêt dans un embouteillage ne doit pas faire
 * pivoter la carte, et deux mètres par seconde valent sept kilomètres-heure.
 */
export const HEADING_MIN_SPEED = 2;

/**
 * Le sens de marche sans cap GPS : la direction entre deux relevés distants
 * d'au moins cela, en mètres — et d'au moins leur incertitude, faute de quoi le
 * tremblement d'un téléphone à l'arrêt passerait pour un déplacement.
 */
export const HEADING_MIN_TRAVEL = 12;

/** Au-delà, le sens de marche connu est trop ancien pour valoir encore. */
export const HEADING_MAX_AGE_MS = 20_000;

/** Tient le sens de marche à jour ; rend la fonction qui le lit (connu et récent, sinon `null`). */
export function useTravelHeading(fix: NavFix | null): () => number | null {
  // Le sens de marche connu, le relevé d'où le mesurer, et quand il a été établi.
  const headingRef = useRef<{ anchor: NavFix | null; heading: number | null; at: number }>({
    anchor: null,
    heading: null,
    at: 0,
  });

  // Le sens de marche, tenu à jour à chaque relevé — pendant le choix aussi,
  // pour qu'il soit connu au moment de partir. Le cap GPS quand la vitesse le
  // rend fiable ; sinon la direction du déplacement depuis un relevé assez
  // éloigné. À l'arrêt, rien : un téléphone immobile annonce n'importe quel cap.
  useEffect(() => {
    if (!fix) return;
    const known = headingRef.current;
    if (fix.heading !== null && (fix.speed ?? 0) > HEADING_MIN_SPEED) {
      headingRef.current = { anchor: fix, heading: fix.heading, at: fix.at };
      return;
    }
    const anchor = known.anchor;
    if (!anchor || fix.at - anchor.at > HEADING_MAX_AGE_MS) {
      headingRef.current = { ...known, anchor: fix };
      return;
    }
    const needed = Math.max(HEADING_MIN_TRAVEL, (anchor.accuracy + fix.accuracy) / 2);
    if (distance(anchor, fix) >= needed) {
      headingRef.current = { anchor: fix, heading: bearing(anchor, fix), at: fix.at };
    }
  }, [fix]);

  /** Le sens de marche s'il est connu et récent, sinon `null`. */
  const travelHeading = useCallback((): number | null => {
    const { heading, at } = headingRef.current;
    return heading !== null && Date.now() - at < HEADING_MAX_AGE_MS ? heading : null;
  }, []);
  return travelHeading;
}
