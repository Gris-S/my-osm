import { currentLocale } from "../../i18n";
import { navText, splitDuration } from "../strings";
import { formatPrice, type TollCost } from "./tolls";

// ---------------------------------------------------------------------------
// Les deux lignes d'une bulle de proposition : la durée, le péage. Sorti de
// `useCarNavigation` sans rien changer.
// ---------------------------------------------------------------------------

/**
 * La durée telle que la bulle l'écrit : « 1h59 », « 45 min ».
 *
 * Les deux lignes de la bulle sont fabriquées ici et non dans un composant,
 * parce que c'est la carte qui les dessine — en éléments du DOM, hors de
 * l'arbre React (voir `MapView`). Elles sont refaites à chaque rendu de la
 * session, donc un changement de langue les reprend comme le reste.
 */
export function durationLabel(seconds: number): string {
  const { value, unit } = splitDuration(seconds);
  return unit ? `${value} ${unit}` : value;
}

/**
 * Le péage, en une ligne.
 *
 * Trois formes seulement, et **aucune ne redit le libellé de la proposition** :
 * la bulle n'a pas la place de nommer deux fois la même chose. « Sans péage »
 * suffit à identifier le parcours gratuit ; un montant identifie les autres.
 */
export function tollLabel(toll: TollCost): string {
  if (toll.kind === "free") return navText("car.tollFree");
  if (toll.kind === "unpriced") return navText("car.tollUnpriced");
  const price = formatPrice(toll.cents, currentLocale());
  return toll.kind === "partial" ? navText("car.tollAtLeast", { price }) : price;
}
