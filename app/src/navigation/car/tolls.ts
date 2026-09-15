import { projectOnSegment } from "../geo";
import type { CarRoute } from "./carRoute";
import type { TollGate } from "./data/tolls";

// ---------------------------------------------------------------------------
// Ce que coûte le péage d'un trajet.
//
// TomTom dit **qu'on paie**, jamais **combien** : sa documentation compte 63
// occurrences de « toll » et aucune de « price » ou « currency », et la réponse
// réelle le confirme — une section à péage s'y réduit à deux index de points.
// Le prix vient donc d'ailleurs, et d'une seule source : la grille tarifaire
// publiée par APRR et AREA, seules sociétés d'autoroutes françaises à publier
// la leur. Vinci (ASF, Cofiroute, Escota), Sanef/SAPN, ATMB et SFTRF ne
// publient rien d'exploitable — recherche faite sur data.gouv.fr.
//
// La conséquence est assumée : **un prix n'est affiché que s'il est officiel**.
// Ailleurs, l'application dit qu'il y a un péage et qu'elle ne sait pas le
// chiffrer. Le choix a été posé explicitement, contre une estimation
// kilométrique qui aurait couvert tout le pays : un chiffre inventé dans un
// écran où l'on compare trois prix est pire qu'un blanc, parce qu'on le
// compare quand même.
//
// ## Comment un trajet est apparié à un couple de gares
//
// Le point à comprendre, et qui a été **mesuré** : les bornes d'une section à
// péage ne sont **pas** les gares. Sur Paris → Lyon, la section commence à
// 3,8 km de la barrière de Fleury-en-Bière et finit à 8,5 km de la gare la plus
// proche. Chercher la gare voisine de chaque extrémité donnerait donc le
// mauvais couple, ou aucun.
//
// On cherche à la place les gares que le tracé **traverse** — à moins de
// `GATE_RADIUS` de la ligne — et on les ordonne le long du parcours. Le prix
// est celui du couple (entrée, sortie) qui couvre la plus longue portion et que
// la grille connaît. Vérifié sur quatre trajets :
//
//   Paris → Lyon        Fleury-en-Bière → Villefranche-Limas   41,30 €
//   Dijon → Lyon        Nuits-St-Georges → Villefranche-Limas  16,00 €
//   Beaune → Besançon   Seurre → Besançon Ouest                 5,40 €
//   Paris → Bordeaux    aucun couple tarifé                    non publié
//
// Le dernier est le cas honnête : l'A10 est à Cofiroute, qui ne publie pas.
// ---------------------------------------------------------------------------

/**
 * Distance maximale entre une gare et le tracé pour tenir le trajet comme la
 * traversant.
 *
 * Mesuré : les gares réellement traversées tombent entre 1 et 386 m du tracé —
 * une gare est large, et le point publié est celui de la barrière, pas celui de
 * la voie empruntée. Quatre cents mètres les attrapent toutes sans attraper
 * l'autoroute d'à côté.
 */
const GATE_RADIUS = 400;

/**
 * Marge autour d'une section à péage dans laquelle une gare compte encore.
 *
 * Elle est large parce que les bornes de section sont elles-mêmes lâches (voir
 * plus haut) : c'est la grille tarifaire, et non cette marge, qui décide in
 * fine qu'un couple est valable.
 */
const SECTION_MARGIN = 15_000;

export type TollCost =
  /** Aucune section à péage sur le parcours. */
  | { kind: "free" }
  /** Tout le péage du parcours est chiffré. */
  | { kind: "priced"; cents: number; gates: string[] }
  /** Une partie seulement est chiffrée : le montant connu est un plancher. */
  | { kind: "partial"; cents: number; gates: string[] }
  /** Il y a un péage, aucune société concernée ne publie ses tarifs. */
  | { kind: "unpriced" };

interface TollData {
  gates: TollGate[];
  /** `entrée:sortie` (rangs dans `gates`) → prix en centimes. */
  prices: Map<string, number>;
}

let loading: Promise<TollData> | null = null;

/**
 * Charge la grille, une fois par session.
 *
 * L'import est **dynamique** : ces deux cents kilo-octets ne concernent que la
 * voiture, et Vite en fait un fragment séparé que le démarrage de la carte ne
 * porte pas. Même raison que pour `mapillary-js`, à une échelle plus modeste.
 */
function load(): Promise<TollData> {
  loading ??= import("./data/tolls").then((module) => {
    const prices = new Map<string, number>();
    // La grille arrive empaquetée dans une chaîne : neuf mille clés d'objet
    // coûtent leur poids en analyse au chargement, un découpage ne coûte que
    // le temps de ce découpage, et seulement si l'on ouvre un trajet voiture.
    for (const entry of module.TOLL_PRICES.split(";")) {
      const [from, to, cents] = entry.split(",");
      if (cents !== undefined) prices.set(`${from}:${to}`, Number(cents));
    }
    return { gates: module.TOLL_GATES, prices };
  });
  return loading;
}

interface GateOnRoute {
  index: number;
  name: string;
  /** Distance depuis le départ à laquelle le tracé passe la gare. */
  atMeters: number;
}

/**
 * Le péage d'un itinéraire.
 *
 * Rien n'est demandé au réseau : la grille est dans le module, le tracé vient
 * du calcul qu'on vient de faire. Le coût est celui des projections, borné par
 * un test d'emprise préalable sur chaque gare.
 */
export async function priceRoute(route: CarRoute): Promise<TollCost> {
  if (!route.tollSections.length) return { kind: "free" };
  const data = await load();

  let total = 0;
  let missing = 0;
  const named: string[] = [];

  for (const section of route.tollSections) {
    const gates = gatesAlong(route, data.gates, section.fromMeters, section.toMeters);
    const found = bestPair(gates, data.prices);
    if (found) {
      total += found.cents;
      named.push(found.from, found.to);
    } else {
      missing += 1;
    }
  }

  if (!named.length) return { kind: "unpriced" };
  return { kind: missing ? "partial" : "priced", cents: total, gates: named };
}

/**
 * Les gares que le tracé traverse dans cette portion, dans l'ordre du parcours.
 *
 * Les doublons sont écartés : le référentiel décrit certaines gares deux fois,
 * et un tracé qui longe une aire de péage peut passer deux fois au même endroit.
 */
function gatesAlong(
  route: CarRoute,
  gates: TollGate[],
  fromMeters: number,
  toMeters: number
): GateOnRoute[] {
  const low = fromMeters - SECTION_MARGIN;
  const high = toMeters + SECTION_MARGIN;
  const found: GateOnRoute[] = [];

  for (let g = 0; g < gates.length; g++) {
    const gate = gates[g];
    let best = Infinity;
    let at = 0;
    for (let i = 0; i < route.points.length - 1; i++) {
      const measure = route.measures[i];
      if (measure < low || measure > high) continue;
      const a = route.points[i];
      // Test d'emprise avant la projection : un degré de latitude vaut
      // 111 km, donc un demi-centième de degré borne largement les 400 m
      // cherchés. Il écarte l'immense majorité des couples sans trigonométrie.
      if (Math.abs(a.lat - gate.lat) > 0.005) continue;
      if (Math.abs(a.lon - gate.lon) > 0.008) continue;
      const b = route.points[i + 1];
      const projection = projectOnSegment(gate, a, b);
      if (projection.offset >= best) continue;
      best = projection.offset;
      const span = route.measures[i + 1] - measure;
      at = measure + span * projection.t;
    }
    if (best <= GATE_RADIUS) found.push({ index: g, name: gate.name, atMeters: at });
  }

  found.sort((a, b) => a.atMeters - b.atMeters);
  return found.filter(
    (gate, i) => i === 0 || gate.index !== found[i - 1].index || gate.atMeters - found[i - 1].atMeters > 2000
  );
}

/**
 * Le couple tarifé qui couvre la plus longue portion du parcours.
 *
 * Un trajet passe une dizaine de gares, dont la plupart sont des échangeurs
 * qu'il longe sans y entrer. C'est la grille qui tranche : le couple le plus
 * étendu qu'elle connaisse est celui qu'on a effectivement emprunté, puisqu'on
 * a payé de la première barrière franchie à la dernière.
 */
function bestPair(
  gates: GateOnRoute[],
  prices: Map<string, number>
): { cents: number; from: string; to: string } | null {
  let best: { cents: number; from: string; to: string; span: number } | null = null;
  for (let i = 0; i < gates.length; i++) {
    for (let j = gates.length - 1; j > i; j--) {
      const span = gates[j].atMeters - gates[i].atMeters;
      if (best && span <= best.span) break; // les suivants seront plus courts
      const cents = prices.get(`${gates[i].index}:${gates[j].index}`);
      if (cents === undefined) continue;
      best = { cents, from: gates[i].name, to: gates[j].name, span };
      break;
    }
  }
  return best && { cents: best.cents, from: best.from, to: best.to };
}

/** Un montant en centimes, écrit dans la devise du lieu : l'euro. */
export function formatPrice(cents: number, locale: string): string {
  return (cents / 100).toLocaleString(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

