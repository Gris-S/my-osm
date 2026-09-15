// ---------------------------------------------------------------------------
// Partage d'un lieu.
//
// Deux façons de faire, selon ce que le navigateur propose : passer la main aux
// applications du téléphone (`navigator.share` — messagerie, e-mail…), ou
// recopier les coordonnées dans le presse-papiers. La première n'existe pas
// partout, notamment sur les navigateurs de bureau : on ne la propose que
// lorsqu'elle est réellement disponible.
// ---------------------------------------------------------------------------

import type { Place } from "../types";
import { formatCoords } from "./clipboard";

export function canUseSystemShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Lien vers le point sur openstreetmap.org.
 *
 * Un `geo:` serait plus direct mais reste inerte dans la plupart des
 * messageries ; une URL https, elle, est cliquable partout et rouvre le lieu
 * sur n'importe quel appareil.
 */
function mapLink(lat: number, lon: number): string {
  const at = `${lat.toFixed(6)}/${lon.toFixed(6)}`;
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=18/${at}`;
}

/**
 * Ouvre le partage du système. Rend `false` si l'utilisateur annule ou si le
 * navigateur refuse — l'appelant garde alors son menu ouvert.
 */
export async function shareViaSystem(place: Place): Promise<boolean> {
  if (!canUseSystemShare()) return false;
  try {
    await navigator.share({
      title: place.name,
      text: `${place.name}\n${formatCoords(place.lat, place.lon)}`,
      url: mapLink(place.lat, place.lon),
    });
    return true;
  } catch {
    return false; // partage annulé
  }
}
