// Le glissement de la flèche et de la caméra pendant la navigation : durées,
// plafond de 60 images par seconde, définition abaissée. Sorti de `MapView.tsx`
// sans rien changer — la boucle elle-même vit dans le composant.


/**
 * Le glissement de la flèche entre deux relevés, **à la manière de Waze**
 * (demande explicite : elle avançait par sauts, un par relevé).
 *
 * Sa durée est **l'intervalle mesuré entre les deux derniers relevés** : le
 * glissement s'achève à peu près quand le suivant arrive, et la flèche ne
 * s'arrête jamais — au prix d'un relevé de retard, imperceptible à l'œil. Les
 * bornes gardent une durée sensée quand l'intervalle déraille : un relevé qui
 * tombe deux fois de suite, ou le retour après une minute en arrière-plan.
 */
export const NAV_GLIDE_MIN_MS = 300;
export const NAV_GLIDE_MAX_MS = 1500;

/**
 * Au-delà de cet écart, la flèche est posée d'un coup : un recalcul, la
 * simulation qui démarre, un retour après une longue coupure. La faire
 * traverser la carte montrerait un trajet qui n'a pas eu lieu.
 */
export const NAV_GLIDE_JUMP_METERS = 250;

/**
 * **60 images par seconde au plus** pendant la navigation (demande explicite :
 * le téléphone chauffait). La caméra n'est plus menée par `easeTo`, qui suit la
 * fréquence de l'écran — 120 Hz sur un Pixel 8, donc cent vingt rendus WebGL de
 * la carte par seconde — mais par notre propre boucle, qui saute les images de
 * trop. La tolérance laisse passer toutes les images d'un écran à 60 Hz, dont
 * l'intervalle oscille autour de 16,7 ms.
 */
export const NAV_FRAME_MS = 1000 / 60;
export const NAV_FRAME_SLACK_MS = 4;

/**
 * Part de la définition de l'écran à laquelle la carte est dessinée pendant la
 * navigation : **légèrement moins**, sans que cela se voie (demande explicite).
 * À 85 %, un Pixel 8 (densité 2,625) rend à 2,23 — 28 % de pixels en moins pour
 * le processeur graphique, à une finesse qui reste au-delà de ce que l'œil
 * distingue sur une carte regardée d'un coup d'œil. Rendue à la sortie.
 */
export const NAV_PIXEL_RATIO_SHARE = 0.85;

/**
 * Durée d'un recadrage **sans glissement** de la flèche : un saut, un
 * changement de zoom, la reprise du suivi. Il passe par la même boucle, donc
 * sous le même plafond de 60 images, avec une courbe amortie. C'était un
 * `easeTo`, relancé à **chaque relevé** même à l'arrêt, pose identique
 * comprise : la carte se redessinait à 120 Hz huit dixièmes de chaque seconde
 * (mesuré à l'arrêt en navigation voiture : 2,6 cœurs, 114 images par seconde).
 */
export const NAV_CAMERA_EASE_MS = 800;

/** Accélère puis freine, comme l'amorti par défaut de MapLibre. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((2 - 2 * t) * (2 - 2 * t)) / 2;
}

/**
 * Vrai si la caméra est déjà à cette pose, à moins d'un pixel près : il n'y a
 * alors rien à redessiner. Un GPS à l'arrêt rend ce cas à chaque relevé.
 */
export function samePose(current: NavCameraPose, wanted: NavCameraPose): boolean {
  return (
    Math.abs(current.center[0] - wanted.center[0]) < 2e-6 &&
    Math.abs(current.center[1] - wanted.center[1]) < 2e-6 &&
    Math.abs(shortestTurn(current.bearing, wanted.bearing)) < 0.2 &&
    Math.abs(current.zoom - wanted.zoom) < 0.01 &&
    Math.abs(current.pitch - wanted.pitch) < 0.2 &&
    Math.abs(current.paddingTop - wanted.paddingTop) < 1
  );
}

/** Une pose de caméra de navigation, telle que la boucle l'interpole. */
export interface NavCameraPose {
  center: [number, number];
  bearing: number;
  zoom: number;
  pitch: number;
  paddingTop: number;
}

/** L'état du glissement : la flèche et la caméra avancent dans la même boucle. */
export interface NavGlide {
  frame: number;
  /** Moment du relevé précédent, pour mesurer l'intervalle. */
  lastAt: number;
  startedAt: number;
  endsAt: number;
  /** Dernière image effectivement dessinée, pour le plafond de 60 par seconde. */
  drawnAt: number;
  target: [number, number] | null;
  arrowFrom: { lng: number; lat: number; bearing: number } | null;
  arrowTo: { lng: number; lat: number; bearing: number } | null;
  camFrom: NavCameraPose | null;
  camTo: NavCameraPose | null;
  camStartedAt: number;
  /** Recadrage amorti, sans flèche qui glisse (voir `NAV_CAMERA_EASE_MS`). */
  camEase: boolean;
}

export function idleGlide(lastAt = 0, target: [number, number] | null = null): NavGlide {
  return {
    frame: 0,
    lastAt,
    startedAt: 0,
    endsAt: 0,
    drawnAt: 0,
    target,
    arrowFrom: null,
    arrowTo: null,
    camFrom: null,
    camTo: null,
    camStartedAt: 0,
    camEase: false,
  };
}

/** Le plus court chemin angulaire : de 350° à 10°, vingt degrés, pas trois cent quarante. */
export function shortestTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
