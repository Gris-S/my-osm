// ---------------------------------------------------------------------------
// Les pastilles qui se chevauchent : dans quel ordre les dessiner, et laquelle
// un toucher désigne.
//
// Constaté le 29 septembre 2026 au Centre Pompidou : le musée (rang 227) et sa
// boutique (rang 371) sont à 8 px l'un de l'autre au zoom 17,5, et toucher le
// musée ouvrait la boutique. Deux causes, qui s'additionnaient :
//
// - **l'ordre de dessin** : MapLibre dessine dans l'ordre de
//   `symbol-sort-key`, les plus petites clés d'abord — donc dessous. La clé
//   étant le rang (petit = important), les lieux importants passaient **sous**
//   les moins importants ;
// - **le choix au toucher** : l'application prenait la première pastille
//   renvoyée sous le doigt, c'est-à-dire celle du dessus.
//
// Et ce n'est pas un cas rare : sur cette même vue, 15 paires de pastilles sur
// 33 étaient à moins de 24 px l'une de l'autre.
// ---------------------------------------------------------------------------

import type { ExpressionSpecification, PropertyValueSpecification } from "maplibre-gl";

/** Le zoom à partir duquel toutes les pastilles sont dessinées, même serrées. */
export const POI_OVERLAP_ZOOM = 15;

/**
 * Les pastilles se chevauchent-elles ? Non en vue large (MapLibre écarte les
 * moins importantes), oui une fois dans la rue — et toujours pour une recherche
 * d'enseigne, dont chaque résultat doit se voir.
 */
export function poiAllowOverlap(brandMode: boolean): PropertyValueSpecification<boolean> {
  return brandMode ? true : ["step", ["zoom"], false, POI_OVERLAP_ZOOM, true];
}

/**
 * L'ordre des pastilles. Tant qu'elles s'écartent, le rang décide qui a la
 * place (le plus important d'abord) ; dès qu'elles se chevauchent, il décide
 * qui est **dessus** — et c'est alors l'inverse qu'il faut : l'ordre est
 * retourné pour que le lieu le plus important soit dessiné en dernier.
 */
export function poiSortKey(brandMode: boolean): ExpressionSpecification {
  const rank: ExpressionSpecification = ["get", "rank"];
  const reversed: ExpressionSpecification = ["-", 0, rank];
  return brandMode ? reversed : ["step", ["zoom"], rank, POI_OVERLAP_ZOOM, reversed];
}

/**
 * Qui montre les pastilles : la couche qui décide (`placement`) tant qu'elles
 * s'écartent, la couche de dessin (`drawn`) dès qu'elles se chevauchent — et
 * toujours la seconde pour une recherche d'enseigne, où tout se chevauche.
 */
export function poiIconsOpacity(brandMode: boolean, layer: "placement" | "drawn"): ExpressionSpecification | number {
  if (layer === "drawn") return brandMode ? 1 : ["step", ["zoom"], 0, POI_OVERLAP_ZOOM, 1];
  return brandMode ? 0 : ["step", ["zoom"], 1, POI_OVERLAP_ZOOM, 0];
}

export interface PoiHit {
  id: string;
  rank: number;
  /** Position de la pastille à l'écran, en pixels. */
  x: number;
  y: number;
}

/**
 * En deçà de cet écart (en pixels), deux pastilles sont « aussi proches » du
 * doigt : le rang les départage. Un doigt ne vise pas mieux que cela.
 */
const TIE_PX = 6;

/**
 * La pastille que désigne un toucher en `(x, y)`, parmi celles qui sont sous
 * le doigt : **la plus proche du point touché** — viser le bord visible d'une
 * pastille à demi cachée la choisit — et, à égalité, la plus importante.
 */
export function pickPoi(hits: PoiHit[], x: number, y: number): PoiHit | null {
  if (!hits.length) return null;
  const withDistance = hits.map((hit) => ({ hit, d: Math.hypot(hit.x - x, hit.y - y) }));
  const nearest = Math.min(...withDistance.map((h) => h.d));
  const close = withDistance.filter((h) => h.d <= nearest + TIE_PX);
  close.sort((a, b) => a.hit.rank - b.hit.rank || a.d - b.d);
  return close[0].hit;
}
