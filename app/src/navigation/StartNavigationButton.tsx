import { Navigation } from "lucide-react";
import { primeRadarSound } from "./car/radars";
import { requestMotionAccess } from "./useStepCounter";
import { useNav } from "./strings";

// ---------------------------------------------------------------------------
// Le bouton « Démarrer », posé dans le résultat du panneau d'itinéraire.
//
// Il est ici, et non dans `ItineraryPanel`, pour que retirer le dossier laisse
// dans le panneau une seule ligne à défaire au lieu d'un bloc de rendu.
//
// Les trois modes l'affichent, et aucun ne démarre la même chose : la marche
// part aussitôt, la voiture passe d'abord par un choix d'itinéraire (sans
// péage, le plus rapide, le moins cher), les transports suivent un horaire.
// C'est `App` qui en décide — ici, le bouton ne connaît que son mode, dont il
// tire ce qu'il faut autoriser avant de partir et ce qu'il annonce.
// ---------------------------------------------------------------------------

export function StartNavigationButton({
  mode,
  onStart,
}: {
  mode: "walking" | "driving" | "transit";
  onStart: () => void;
}) {
  const { nav } = useNav();

  /**
   * Les autorisations qui demandent un **geste de l'utilisateur** se prennent
   * ici, dans le gestionnaire du clic, et non dans un effet du guidage : ni
   * iOS pour les capteurs de mouvement, ni aucun navigateur pour la sortie
   * audio ne les accordent ailleurs, et le contexte du geste est perdu dès
   * qu'on passe par un effet.
   *
   * - à pied, les **capteurs de mouvement** : un refus coûte le comptage des
   *   pas, qui retombe sur l'estimation par la distance, pas le guidage ;
   * - en voiture, la **sortie audio** : sans elle, le premier radar serait muet
   *   sans que rien ne l'explique.
   *
   * Les transports n'ont besoin ni de l'une ni de l'autre — ils ne comptent pas
   * les pas et ne font aucun bruit. Le départ n'attend aucune réponse.
   */
  function start() {
    if (mode === "walking") void requestMotionAccess();
    if (mode === "driving") primeRadarSound();
    onStart();
  }

  return (
    <button className="nav-start" onClick={start} aria-label={nav(ARIA[mode])}>
      <Navigation size={16} />
      {nav("nav.start")}
    </button>
  );
}

/**
 * Ce que la synthèse vocale annonce. Le libellé visible est le même pour les
 * trois — « Démarrer », posé dans le résultat du mode en cours, ne prête pas à
 * confusion — mais lu seul, hors de son contexte, il ne dit pas ce qu'on
 * démarre.
 */
const ARIA = {
  walking: "nav.startAria",
  driving: "car.startAria",
  transit: "transit.startAria",
} as const;
