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

/**
 * En deçà, le retard ne s'annonce pas : « +0 min » n'apprend rien, et une minute
 * d'écart est sous la précision d'une prévision de trafic.
 */
const TRAFFIC_WORTH_SAYING_SECONDS = 60;

/**
 * La seconde ligne de la bulle : le péage, et **ce que le trafic coûte**.
 *
 * Elle reste **une seule ligne** — la bulle en a deux, et la première porte la
 * durée. On étend donc la ligne du péage au lieu d'en ajouter une troisième.
 *
 * Sans cette mention, la durée paraissait fausse : sur un Louvre → Bastille de
 * 2,8 km, TomTom annonce 24 min là où la route vide en demande 10. Le chiffre
 * était juste — deux bouchons mesurés à 235 et 283 secondes — mais rien ne
 * l'expliquait, et un nombre qu'on ne s'explique pas est un nombre auquel on ne
 * se fie pas. `null` avec OSRM, qui ne sait rien du trafic : on se tait alors,
 * plutôt que d'annoncer un zéro qui se lirait « route dégagée ».
 */
export function choiceDetail(toll: TollCost, trafficDelaySeconds: number | null): string {
  const toll_ = tollLabel(toll);
  if (trafficDelaySeconds === null || trafficDelaySeconds < TRAFFIC_WORTH_SAYING_SECONDS) return toll_;
  const minutes = Math.round(trafficDelaySeconds / 60);
  return `${toll_} · ${navText("car.trafficDelay", { minutes })}`;
}
