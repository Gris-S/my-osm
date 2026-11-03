import type { LonLat, Place } from "../types";
import { distance } from "../navigation/geo";
import { normalizeText, textScore } from "./textMatch";

// ---------------------------------------------------------------------------
// Une seule liste à partir de trois sources qui n'arrivent pas en même temps :
// les lieux de la carte (instantanés), Photon (une seconde plus tard), et pour
// une catégorie, OpenStreetMap autour du point regardé (Overpass). Pur et testé
// (`tests/searchRank.test.ts`).
//
// Le classement mêle trois choses, comme une recherche de carte : le nom qui
// répond à la saisie, la **proximité du point regardé** (l'échelle suit le
// zoom : au zoom 14, 2,5 km comptent beaucoup ; vu du pays, 40 km peu), et
// l'ordre de Photon, qui sait ce qui est connu (la tour Eiffel).
// ---------------------------------------------------------------------------

/** Un lieu de la carte qui répond à la saisie (voir `searchSeenPois`). */
export interface LocalMatch {
  place: Place;
  text: number;
  meters: number;
}

export interface RankInput {
  query: string;
  focus: LonLat;
  zoom: number;
  local: readonly LocalMatch[];
  /** Réponse de Photon, dans son ordre ; `null` tant qu'elle n'est pas arrivée. */
  remote: readonly Place[] | null;
  /** La saisie est une catégorie : sa valeur de tag (`pharmacy`), et les lieux trouvés autour. */
  category?: { value: string; places: readonly Place[] } | null;
}

/** Distance à laquelle la proximité ne vaut plus qu'un tiers, selon le zoom. */
export function proximityScale(zoom: number): number {
  return 40_000 / 2 ** (Math.min(17, Math.max(5, zoom)) - 10);
}

/** Même lieu : même identifiant, ou même nom à moins de 80 m (tuile contre Photon). */
function samePlace(a: Place, b: Place): boolean {
  if (a.id === b.id) return true;
  return normalizeText(a.name) === normalizeText(b.name) && distance(a, b) < 80;
}

function pushUnique(out: Place[], place: Place): void {
  if (!out.some((other) => samePlace(other, place))) out.push(place);
}

export function rankResults({ query, focus, zoom, local, remote, category }: RankInput): Place[] {
  const scale = proximityScale(zoom);
  const out: Place[] = [];

  // Une catégorie : ses lieux d'abord, du plus proche au plus loin, d'où
  // qu'ils viennent ; ensuite le reste de Photon, dans son ordre.
  if (category) {
    const ofCategory = [
      ...local.filter((m) => m.place.rawType === category.value).map((m) => m.place),
      ...category.places,
      ...(remote ?? []).filter((p) => p.rawType === category.value),
    ].sort((a, b) => distance(focus, a) - distance(focus, b));
    for (const place of ofCategory) pushUnique(out, place);
    for (const place of remote ?? []) pushUnique(out, place);
    return out;
  }

  const scored: { place: Place; score: number }[] = [];
  const proximity = (place: Place) => Math.exp(-distance(focus, place) / scale);
  for (const m of local) {
    scored.push({ place: m.place, score: 0.55 * m.text + 0.35 * Math.exp(-m.meters / scale) });
  }
  (remote ?? []).forEach((place, i) => {
    // Photon a déjà jugé que le lieu répond (adresses, numéros, noms d'autres
    // langues) : son avis compte au moins pour 0,6, et son rang s'y ajoute.
    const text = Math.max(0.6, textScore(query, place.name));
    scored.push({ place, score: 0.55 * text + 0.35 * proximity(place) + 0.2 * (1 - i / 20) });
  });
  scored.sort((a, b) => b.score - a.score);
  for (const { place } of scored) pushUnique(out, place);
  return out;
}
