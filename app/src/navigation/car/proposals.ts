import type { LonLat } from "../../types";
import { cachedCarRoutes, ETA_ALTERNATIVES } from "./carEta";
import { getCarRoutes, hasLiveEngine, type CarRoute } from "./carRoute";
import { priceRoute, type TollCost } from "./tolls";

// ---------------------------------------------------------------------------
// Les propositions faites avant de démarrer.
//
// Trois au plus, et **le nombre s'adapte au trajet** :
//
//   1. sans péage
//   2. avec péage, le plus rapide
//   3. avec péage, moins cher mais plus lent
//
// La troisième n'existe que si elle existe vraiment, et c'est là tout le travail
// de ce module. Elle se cherche parmi les **itinéraires de rechange** de TomTom,
// et nulle part ailleurs : `routeType=shortest` et `routeType=eco` ont été
// essayés pour la fabriquer, tous deux rendent le même trajet et le même prix
// que `fastest`.
//
// Mesuré, sur cinq trajets réels :
//
//   Dijon → Lyon        3 choix   gratuit 216 min · 16,00 € 119 min · 7,10 € 144 min
//   Lyon → Grenoble     3 choix   gratuit 112 min ·  9,70 €  71 min · 7,20 € 110 min
//   Paris → Lyon        2 choix   la rechange la moins chère n'est que
//                                 partiellement chiffrée — voir `cheapest`
//   Paris → Bordeaux    2 choix   aucun tarif publié sur ce réseau
//   Paris → La Défense  1 choix   pas un mètre de péage
//
// La dernière ligne est la règle générale : un trajet sans autoroute payante ne
// donne qu'une proposition. Offrir « sans péage » et « le plus rapide » côte à
// côte quand ce sont les mêmes kilomètres ferait un choix sans objet.
//
// ## Ce que cela coûte
//
// Deux appels par calcul — un pour le meilleur et ses rechanges, un pour le
// sans-péage — sur un palier de 20 000 par mois. Le guidage en demandera un
// troisième, celui-là seul avec les manœuvres, les voies et les vitesses : les
// réclamer pour quatre itinéraires dont trois seront écartés multiplierait le
// poids de la réponse par cinq pour rien.
// ---------------------------------------------------------------------------

export type ProposalId = "free" | "fast" | "cheap";

export interface CarProposal {
  id: ProposalId;
  route: CarRoute;
  toll: TollCost;
}

/**
 * Nombre d'itinéraires de rechange demandés.
 *
 * Trois : au-delà, TomTom rend des variantes de plus en plus semblables au
 * meilleur, et chacune coûte son poids dans la réponse pour une chance
 * décroissante d'être moins chère.
 */
const ALTERNATIVES = ETA_ALTERNATIVES;

/**
 * Écart minimal, en centimes, pour qu'un itinéraire mérite d'être appelé
 * « moins cher ». Proposer de rouler vingt minutes de plus pour économiser
 * cinquante centimes serait se moquer du conducteur.
 */
const WORTH_IT_CENTS = 150;

export async function getCarProposals(
  points: LonLat[],
  signal?: AbortSignal
): Promise<CarProposal[]> {
  // Sans clé TomTom, OSRM ne connaît ni le trafic ni les péages et n'a aucun
  // moyen d'honorer « sans péage » : plutôt que d'étiqueter trois fois le même
  // trajet, on n'en propose qu'un — et l'écran de choix explique ce qui manque.
  if (!hasLiveEngine()) {
    const [route] = await getCarRoutes(points, { signal });
    return [{ id: "fast", route, toll: { kind: "free" } }];
  }

  // Les deux appels partent ensemble : ils ne dépendent pas l'un de l'autre, et
  // l'écran de choix n'a rien à montrer tant que les deux ne sont pas là.
  const [tolled, untolled] = await Promise.all([
    // **Le même appel que le panneau d'itinéraire vient de faire** : il est donc
    // le plus souvent déjà là, et le départ ne le repaie pas (`carEta.ts`).
    // Sans signal, à dessein — le travail est partagé entre les deux écrans.
    cachedCarRoutes(points, { alternatives: ALTERNATIVES }),
    getCarRoutes(points, { avoidTolls: true, signal }).catch(() => {
      // Il n'existe pas toujours de chemin sans péage — une vallée alpine, un
      // tunnel obligatoire. C'est une proposition en moins, pas un échec.
      return [] as CarRoute[];
    }),
  ]);

  const fastest = tolled[0];
  const priced = await Promise.all(tolled.map((route) => priceRoute(route)));

  // Le trajet le plus rapide ne passe par aucun péage : il n'y a qu'un chemin à
  // proposer, et l'appeler « sans péage » suffit.
  if (priced[0].kind === "free") {
    return [{ id: "free", route: fastest, toll: priced[0] }];
  }

  const proposals: CarProposal[] = [];

  const free = untolled[0];
  if (free) {
    const freeToll = await priceRoute(free);
    // TomTom honore `avoid=tollRoads` — vérifié, la réponse ne porte plus
    // aucune section à péage — mais on ne se contente pas de sa parole : si le
    // trajet rendu en garde une, ce n'est pas un trajet sans péage.
    if (freeToll.kind === "free") proposals.push({ id: "free", route: free, toll: freeToll });
  }

  proposals.push({ id: "fast", route: fastest, toll: priced[0] });

  const cheaper = cheapest(tolled, priced);
  if (cheaper) proposals.push(cheaper);

  return proposals;
}

/**
 * L'itinéraire de rechange qui coûte moins cher que le plus rapide.
 *
 * **Les deux prix doivent être complets**, et c'est la condition la plus
 * importante. Un péage partiellement chiffré — un trajet qui passe d'un réseau
 * publiant ses tarifs à un réseau qui n'en publie pas — ne rend qu'un
 * *plancher* : « au moins 4,10 € ». Le comparer au montant complet du plus
 * rapide reviendrait à annoncer une économie de trente-sept euros là où le
 * reste du parcours est justement ce qu'on ignore. C'est exactement le genre de
 * chiffre trompeur que la règle « prix exact seulement » vise à écarter.
 *
 * Mesuré : sur Paris → Lyon, l'itinéraire de rechange rendait « au moins
 * 4,10 € » contre 41,30 € pour l'A6, alors que sa portion non chiffrée traverse
 * tout le réseau de Cofiroute. Il n'est donc pas proposé, et l'écran n'affiche
 * que deux choix.
 *
 * Restent deux conditions : l'itinéraire doit **encore** passer par un péage
 * (sans quoi c'est la proposition « sans péage », déjà faite) et coûter
 * sensiblement moins.
 */
function cheapest(routes: CarRoute[], costs: TollCost[]): CarProposal | null {
  const reference = costs[0];
  if (reference.kind !== "priced") return null;

  let best: CarProposal | null = null;
  let bestCents = reference.cents - WORTH_IT_CENTS;

  for (let i = 1; i < routes.length; i++) {
    const cost = costs[i];
    if (cost.kind !== "priced") continue;
    if (cost.cents > bestCents) continue;
    // Un parcours à la fois moins cher **et** plus rapide n'est pas un
    // compromis : c'est que le premier n'était pas le meilleur. Le cas ne se
    // présente pas — TomTom classe par durée — mais l'étiquette « moins rapide »
    // doit rester vraie.
    if (routes[i].durationSeconds <= routes[0].durationSeconds) continue;
    bestCents = cost.cents;
    best = { id: "cheap", route: routes[i], toll: cost };
  }
  return best;
}

/**
 * Où poser la bulle de chaque proposition : l'endroit où ce parcours **s'écarte
 * le plus des autres**.
 *
 * C'est le seul choix qui rende les bulles lisibles. Les poser au milieu de
 * chaque tracé les empilerait là où les parcours sont encore confondus — sur
 * Paris → Lyon, les trois partent par la même porte et se séparent quarante
 * kilomètres plus loin. En les plaçant là où les routes divergent, chaque bulle
 * tombe sur un tronçon qui n'appartient qu'à elle, et désigne sans ambiguïté la
 * ligne qu'on va suivre.
 *
 * Quand les parcours se ressemblent au point de n'avoir aucun endroit propre —
 * ce qui arrive quand deux propositions ne diffèrent que par une bretelle — on
 * retombe sur des fractions échelonnées le long du tracé, pour que les bulles
 * ne se recouvrent pas.
 */
export function bubbleAnchors(routes: LonLat[][]): LonLat[] {
  /** Points d'un tracé, réduits à une centaine : la comparaison est grossière. */
  const sampled = routes.map((points) => thin(points, SAMPLES));

  const anchors: LonLat[] = [];
  routes.forEach((points, index) => {
    const mine = sampled[index];
    const others = sampled.filter((_, i) => i !== index).flat();

    // Pour chaque point du tracé, sa distance au plus proche des autres
    // parcours. Le maximum désigne le milieu de la portion qui n'est qu'à nous.
    const scored = mine.map((point) => ({
      point,
      apart: others.length ? Math.min(...others.map((other) => rough(point, other))) : Infinity,
    }));

    // On prend le point le plus à l'écart **qui ne tombe pas sur une bulle déjà
    // posée** : se contenter du meilleur et abandonner s'il est mal placé
    // laisserait passer le deuxième meilleur, souvent tout aussi bon. Deux
    // bulles à moins de `MIN_APART` se recouvrent à l'écran quel que soit le
    // zoom auquel on compare deux itinéraires.
    const candidate = scored
      .filter((entry) => entry.apart > MIN_APART)
      .sort((a, b) => b.apart - a.apart)
      .find((entry) => anchors.every((placed) => rough(placed, entry.point) > MIN_APART));

    // Aucun endroit propre : deux parcours qui ne diffèrent que par une
    // bretelle. Les bulles s'étagent alors le long du tracé — elles ne diront
    // pas *où* les parcours divergent, mais elles resteront lisibles et
    // distinctes, ce qui est le minimum exigible.
    anchors.push(candidate?.point ?? along(points, (index + 1) / (routes.length + 1)));
  });
  return anchors;
}

/** Nombre de points retenus par tracé pour la comparaison. */
const SAMPLES = 120;

/**
 * Écart minimal, en mètres, pour qu'une bulle soit tenue pour bien placée.
 * Deux kilomètres : en dessous, à l'échelle où l'on compare deux itinéraires,
 * les deux bulles se touchent.
 */
const MIN_APART = 2000;

function thin(points: LonLat[], count: number): LonLat[] {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]);
}

/** Le point situé à la fraction `t` du tracé, en nombre de points. */
function along(points: LonLat[], t: number): LonLat {
  return points[Math.min(points.length - 1, Math.max(0, Math.round((points.length - 1) * t)))];
}

/**
 * Distance approchée, en mètres, sur un plan local.
 *
 * L'approximation suffit largement ici — on compare des écarts de plusieurs
 * kilomètres — et cette fonction est appelée quelques dizaines de milliers de
 * fois par calcul de propositions.
 */
function rough(a: LonLat, b: LonLat): number {
  const x = (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180) * 111320;
  const y = (a.lat - b.lat) * 110540;
  return Math.hypot(x, y);
}
