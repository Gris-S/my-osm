import type { Position } from "./model";

// ---------------------------------------------------------------------------
// Décodage d'une polyligne encodée (algorithme de Google), la forme sous
// laquelle MOTIS — le moteur de Transitous — rend ses tracés. Transitous
// l'emploie en précision 6 (`legGeometry.precision`), et non 5 comme Google :
// se tromper de précision pose le tracé dix fois trop loin de l'origine.
// ---------------------------------------------------------------------------

/** Rend des positions `[longitude, latitude]` ; une chaîne tronquée s'arrête au dernier point complet. */
export function decodePolyline(encoded: string, precision = 6): Position[] {
  const factor = 10 ** precision;
  const positions: Position[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    positions.push([lon / factor, lat / factor]);
  }
  return positions;
}
