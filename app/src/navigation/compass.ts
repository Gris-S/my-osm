// ---------------------------------------------------------------------------
// La boussole du téléphone : où il est tourné, pour le cône de la navigation
// à pied et en transports (demande explicite). La flèche, elle, garde le sens
// de la marche.
//
// **Hors de React, volontairement.** Le capteur répond jusqu'à soixante fois
// par seconde : passé par l'état, il ferait redessiner toute l'application à
// cette cadence. La carte s'y abonne et tourne le cône elle-même, comme elle
// fait déjà glisser la flèche (`MapView`).
//
// Seule une orientation **absolue** — rapportée au nord — sert : l'événement
// `deviceorientationabsolute` sous Android. Un `deviceorientation` relatif
// dirait où le téléphone a tourné depuis son allumage, pas où il regarde, et
// un cône faux vaut moins que pas de cône. Sans capteur, aucun cône.
// ---------------------------------------------------------------------------

type Listener = (heading: number) => void;

const listeners = new Set<Listener>();
/** Composantes lissées du cap (est, nord) : un angle se lisse mal tel quel. */
let smoothed: { east: number; north: number } | null = null;
let lastHeading: number | null = null;

/** Part d'un nouveau relevé dans le cap lissé : le capteur tremble. */
const SMOOTHING = 0.25;

/**
 * Le cap, en degrés depuis le nord dans le sens horaire, d'un téléphone
 * orienté par les angles `alpha`, `beta`, `gamma` d'un événement absolu.
 *
 * Ce qui compte est **où l'on regarde**, quelle que soit la façon de tenir le
 * téléphone : à plat, c'est le haut de l'écran ; tenu droit devant soi, c'est
 * le dos du téléphone, le haut de l'écran pointant alors vers le ciel. La
 * somme des deux directions ramenées à l'horizontale couvre les deux cas et
 * tout l'entre-deux, où elles pointent vers l'avant. `null` quand elle
 * s'annule — téléphone tenu tête en bas, sans direction lisible.
 */
export function compassHeading(alpha: number, beta: number, gamma: number): number | null {
  const rad = Math.PI / 180;
  const [cA, sA] = [Math.cos(alpha * rad), Math.sin(alpha * rad)];
  const [cB, sB] = [Math.cos(beta * rad), Math.sin(beta * rad)];
  const [cG, sG] = [Math.cos(gamma * rad), Math.sin(gamma * rad)];
  // Le haut de l'écran (axe Y) et le dos du téléphone (−Z), dans le repère
  // est / nord (spécification W3C, rotations Z-X'-Y'').
  const east = -sA * cB + (-cA * sG - sA * sB * cG);
  const north = cA * cB + (-sA * sG + cA * sB * cG);
  if (Math.hypot(east, north) < 0.2) return null;
  return (Math.atan2(east, north) / rad + 360) % 360;
}

function handle(event: DeviceOrientationEvent) {
  if (event.alpha === null || event.beta === null || event.gamma === null) return;
  const raw = compassHeading(event.alpha, event.beta, event.gamma);
  if (raw === null) return;
  const east = Math.sin((raw * Math.PI) / 180);
  const north = Math.cos((raw * Math.PI) / 180);
  smoothed = smoothed
    ? { east: smoothed.east + (east - smoothed.east) * SMOOTHING, north: smoothed.north + (north - smoothed.north) * SMOOTHING }
    : { east, north };
  const heading = ((Math.atan2(smoothed.east, smoothed.north) * 180) / Math.PI + 360) % 360;
  // Sous le degré, rien ne se verrait : inutile de retoucher le cône.
  if (lastHeading !== null && Math.abs(((heading - lastHeading + 540) % 360) - 180) < 1) return;
  lastHeading = heading;
  for (const listener of listeners) listener(heading);
}

/**
 * S'abonne au cap. Le capteur n'écoute que tant qu'il y a un abonné : hors
 * navigation, il ne coûte rien. Rend la fonction de désabonnement.
 */
export function subscribeCompass(listener: Listener): () => void {
  if (listeners.size === 0) window.addEventListener("deviceorientationabsolute", handle as EventListener);
  listeners.add(listener);
  if (lastHeading !== null) listener(lastHeading);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener("deviceorientationabsolute", handle as EventListener);
    smoothed = null;
    lastHeading = null;
  };
}
