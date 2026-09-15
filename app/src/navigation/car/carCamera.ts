// ---------------------------------------------------------------------------
// Le cadrage de la navigation voiture : zoom selon la manœuvre à venir, place
// du conducteur dans l'écran, zone morte à l'arrêt, recul toléré de la flèche.
// Sorti de `useCarNavigation` sans rien changer.
// ---------------------------------------------------------------------------

/** La carte reste vue de dessus, pour les raisons dites dans `useNavigation`. */
export const NAV_PITCH = 0;

export const GROUND_RESOLUTION = 156543.03392;

/**
 * Bornes du cadrage, plus larges qu'à pied (15,5 – 18,5).
 *
 * Une voiture couvre en dix secondes ce qu'un marcheur met trois minutes à
 * faire : à zoom de marche, la prochaine manœuvre serait hors de l'écran en
 * permanence sur route, et le conducteur ne verrait jamais venir un échangeur.
 * Le plafond reste haut pour les carrefours de ville, où l'on tourne dans une
 * rue et non dans une bretelle.
 */
export const ZOOM_MIN = 12.5;
export const ZOOM_MAX = 17.5;
export const ZOOM_DEFAULT = 16;

/** Où le conducteur se tient dans la hauteur de l'écran. */
export const DRIVER_AT = 0.72;

/**
 * Part de la hauteur d'écran séparant le conducteur de la manœuvre à venir.
 *
 * Un peu moins qu'à pied (0,42) parce que le bandeau voiture est plus haut : il
 * porte l'action **et** la direction, et parfois la bande des voies en dessous.
 */
export const LOOK_AHEAD_SHARE = 0.36;

/**
 * Déplacement en deçà duquel la caméra ne bouge pas, en mètres.
 *
 * À l'arrêt, le relevé GPS tremble et sa projection sur le tracé **glisse le
 * long de la route** : la carte dérive alors doucement alors que la voiture ne
 * bouge pas — constaté sur un vrai téléphone. Cinq mètres de zone morte suffisent
 * à l'immobiliser sans qu'on perçoive de retard une fois en mouvement, où l'on
 * parcourt bien plus que cela entre deux relevés.
 */
export const CAMERA_DEAD_ZONE = 5;

/**
 * Recul toléré de la flèche, en mètres.
 *
 * Sur le parcours, la flèche est **aimantée au trait bleu** (demande explicite :
 * elle tremblait de part et d'autre de la ligne) et **n'avance que vers
 * l'avant** : un relevé qui la ramène de quelques mètres en arrière n'est que
 * du bruit, et on la laisse où elle est. Au-delà de cette distance, ce n'est
 * plus du bruit — demi-tour sur le parcours, boucle — et on la suit.
 */
export const ARROW_BACKTRACK_METERS = 30;

export function paddingTop(): number {
  return Math.max(0, (2 * DRIVER_AT - 1) * window.innerHeight);
}

/** Le zoom qui fait tenir une manœuvre à `distance` mètres dans l'écran. */
export function zoomFor(distanceMeters: number, lat: number): number {
  const pixels = Math.max(200, window.innerHeight * LOOK_AHEAD_SHARE);
  const metersPerPixel = Math.max(20, distanceMeters) / pixels;
  const zoom = Math.log2((GROUND_RESOLUTION * Math.cos((lat * Math.PI) / 180)) / metersPerPixel);
  // Arrondi au dixième : le zoom suit une distance qui change à chaque relevé,
  // et une valeur au millième relancerait une animation pour rien.
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom * 10) / 10));
}
