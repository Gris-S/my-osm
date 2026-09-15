import { useEffect, useRef, useState } from "react";
import type { LonLat } from "../types";
import { distance } from "./geo";
import { navText } from "./strings";
import { useActivation } from "../hooks/useActivation";

// ---------------------------------------------------------------------------
// Le suivi continu de la position.
//
// C'est **délibérément un hook à part** de `useGeolocation`. Ce dernier rend
// une position à la demande (`getCurrentPosition`) et son interface est promise
// telle quelle au portage Capacitor : elle ne doit pas bouger. Le guidage, lui,
// a besoin d'un flux — d'où `watchPosition`, dont l'abonnement s'ouvre au
// départ et se ferme à l'arrivée.
//
// Le portage APK se fait ici de la même façon : `Geolocation.watchPosition` de
// `@capacitor/geolocation` rend la même forme d'objet.
// ---------------------------------------------------------------------------

export interface NavFix extends LonLat {
  /** Rayon d'incertitude annoncé par l'appareil, en mètres. */
  accuracy: number;
  /** Cap de déplacement, quand l'appareil le connaît. */
  heading: number | null;
  /**
   * Vitesse au sol en m/s.
   *
   * Elle vient du récepteur GNSS quand il la donne — c'est une mesure Doppler,
   * précise et stable, et c'est le cas le plus courant sur téléphone. Certains
   * appareils et certains relevés ne la portent pas : elle est alors **déduite
   * de deux relevés consécutifs**, de sorte que le compteur ne s'éteigne jamais
   * en roulant. Voir `derivedSpeed`.
   */
  speed: number | null;
  /**
   * Vrai quand `speed` a été **déduite** de deux relevés faute de mesure de
   * l'appareil. Le chiffre est alors nettement moins sûr — quelques km/h
   * d'incertitude contre une fraction — et ce qui s'appuie dessus doit en tenir
   * compte : l'indicateur de dépassement élargit sa tolérance plutôt que
   * d'accuser sur une mesure qu'il sait imprécise.
   */
  speedDerived: boolean;
  at: number;
}

interface State {
  fix: NavFix | null;
  error: string | null;
}

/**
 * Suit la position tant que `active` est vrai.
 *
 * `maximumAge: 0` : un relevé recyclé de la minute précédente placerait le
 * marcheur là où il était, ce qui est pire que pas de relevé du tout.
 */
export function useNavPosition(active: boolean): State {
  // Le numéro du suivi en cours : un relevé est rangé avec lui, et celui d'un
  // suivi précédent n'est plus rendu (`useActivation`).
  const session = useActivation(active);
  const [state, setState] = useState<State & { session: number }>({ fix: null, error: null, session: 0 });
  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;
  // Le relevé précédent et la vitesse lissée, pour la déduire quand l'appareil
  // ne la donne pas. Des refs et non un état : elles ne redessinent rien
  // d'elles-mêmes, et elles sont lues dans le rappel de `watchPosition`, qui
  // n'est installé qu'une fois.
  const previousRef = useRef<NavFix | null>(null);
  const smoothRef = useRef<Smoothing>({ value: null, window: [] });

  useEffect(() => {
    if (!active || !supported) return;

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const fix: NavFix = {
          lon: position.coords.longitude,
          lat: position.coords.latitude,
          accuracy: position.coords.accuracy,
          heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
          speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
          speedDerived: false,
          at: position.timestamp,
        };
        // L'appareil ne donne pas toujours la vitesse : on la déduit alors du
        // déplacement depuis le relevé précédent, plutôt que de laisser le
        // compteur vide en pleine route.
        if (fix.speed === null) {
          fix.speed = derivedSpeed(previousRef.current, fix, smoothRef);
          fix.speedDerived = fix.speed !== null;
        }
        // À l'arrêt, tout ce qui reste est du bruit : on le dit zéro plutôt que
        // d'afficher une vitesse qu'on n'a pas.
        if (fix.speed !== null && fix.speed < STANDSTILL_MS) fix.speed = 0;
        previousRef.current = fix;
        setState({ fix, error: null, session });
      },
      (error) => {
        // Un relevé perdu en cours de route n'efface pas le précédent : sous un
        // porche ou dans un tunnel, mieux vaut la dernière position connue
        // qu'un panneau vide. Seul le refus d'autorisation est définitif.
        setState((current) => {
          const fix = current.session === session ? current.fix : null;
          return {
            session,
            fix,
            error:
              error.code === error.PERMISSION_DENIED
                ? navText("nav.errorDenied")
                : fix
                  ? null
                  : navText("nav.errorPosition"),
          };
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watch);
      previousRef.current = null;
      smoothRef.current = { value: null, window: [] };
    };
  }, [active, supported, session]);

  // Le suivi éteint ne rend rien, et un suivi rouvert repart du relevé du
  // moment, pas de celui d'un trajet précédent. Sans API de position, l'erreur
  // se dit tout de suite.
  if (!active) return IDLE;
  if (!supported) return { fix: null, error: navText("nav.errorPosition") };
  return state.session === session ? state : IDLE;
}

/** Aucun relevé : un seul objet, pour ne pas provoquer de rendu à chaque appel. */
const IDLE: State = { fix: null, error: null };

/**
 * En deçà de cette vitesse, on considère l'appareil **immobile**.
 *
 * Un demi-mètre par seconde, soit moins de deux kilomètres-heure. Deux raisons,
 * et la seconde a été constatée sur un vrai téléphone à l'arrêt : le récepteur
 * lui-même annonce parfois quelques dixièmes de mètre par seconde alors que
 * rien ne bouge, et la vitesse déduite du déplacement, elle, transforme le
 * tremblement de position en vitesse pure et simple.
 */
const STANDSTILL_MS = 0.5;

/** L'état du lissage : la valeur courante, et les derniers calculs bruts. */
interface Smoothing {
  value: number | null;
  window: number[];
}

/**
 * La vitesse déduite de deux relevés, quand l'appareil ne la mesure pas.
 *
 * **Ce repli est bruyant par nature**, et c'est ce qui dicte son traitement. Une
 * vitesse calculée sur une seconde à partir de positions précises à quelques
 * mètres près se trompe de plusieurs dizaines de kilomètres-heure : sept mètres
 * de tremblement en une seconde, ce sont vingt-cinq kilomètres-heure d'erreur.
 * La vitesse du récepteur, elle, est une mesure Doppler et n'a pas ce défaut —
 * c'est pourquoi on la préfère toujours et qu'on ne la lisse jamais.
 *
 * Deux filtres en série, et il faut les deux :
 *
 * - une **médiane sur trois calculs**, qui supprime les sauts isolés ;
 * - une **moyenne exponentielle**, qui rabote ce qui reste.
 *
 * Mesuré en simulant un GPS de voiture (±7 m) à 90 km/h, puis un freinage à
 * 50 : la moyenne seule oblige à choisir entre ±3,8 km/h de tremblement avec
 * quinze secondes de retard au freinage, et trois secondes de retard avec
 * ±10,6 km/h. Les deux filtres ensemble rendent ±6,9 km/h pour cinq secondes,
 * ce qu'aucun réglage de la moyenne seule n'atteint.
 *
 * Rend `null` quand rien de sensé ne peut être calculé : premier relevé, deux
 * relevés trop rapprochés pour que l'écart signifie quelque chose, ou trop
 * espacés pour que la moyenne décrive encore l'instant présent.
 */
function derivedSpeed(
  previous: NavFix | null,
  current: NavFix,
  smooth: { current: Smoothing }
): number | null {
  const state = smooth.current;
  if (!previous) return null;
  const seconds = (current.at - previous.at) / 1000;
  // En deçà d'un tiers de seconde, le bruit de position domine le déplacement ;
  // au-delà de dix, on a traversé un tunnel et la moyenne ne dit plus rien de
  // la vitesse actuelle.
  if (seconds < 0.33 || seconds > 10) {
    state.value = null;
    state.window = [];
    return null;
  }
  const moved = distance(previous, current);

  // **Le garde-fou de l'immobilité, et c'est le plus important de ce fichier.**
  // Un relevé GPS tremble de plusieurs mètres à l'arrêt ; divisé par une
  // seconde, ce tremblement devient une vitesse — constaté sur un téléphone
  // posé, immobile, qui affichait une vitesse variable et voyait son point
  // glisser sur la carte. Tant que le déplacement reste dans l'incertitude que
  // l'appareil annonce lui-même, il n'y a **rien** à mesurer : c'est du bruit,
  // et la bonne réponse est zéro, pas une moyenne de bruit.
  //
  // La comparaison se fait sur la moins bonne des deux précisions : deux
  // relevés à huit mètres près ne disent rien d'un déplacement de six.
  const uncertainty = Math.max(previous.accuracy, current.accuracy, 5);
  if (moved < uncertainty) {
    state.window = [];
    state.value = 0;
    return 0;
  }

  const raw = moved / seconds;
  // Au-delà de 80 m/s (288 km/h), c'est un saut de position et non un
  // déplacement : le relevé est écarté plutôt que de rendre un chiffre absurde.
  if (raw > 80) return state.value;

  state.window.push(raw);
  if (state.window.length > 3) state.window.shift();
  const sorted = [...state.window].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  state.value = state.value === null ? median : state.value * 0.65 + median * 0.35;
  return state.value;
}
