import { distance } from "../navigation/geo";
import type { LonLat } from "../types";
import type { BikeNetwork } from "./bikes";
import type { LiveItem } from "./useLiveLayer";

// ---------------------------------------------------------------------------
// Ce que la barre de recherche propose des modes en direct (demande
// explicite) : « essence », « station service », « borne », « vélib »…
// donnent « Afficher toutes les … » puis les plus proches ; le nom d'un réseau
// d'une autre ville (« Vélo'v ») recentre la carte sur elle. Un mode éteint
// le dit, plutôt que de laisser croire que rien n'existe.
//
// Fonction pure, testée (`tests/liveSearch.test.ts`) : la barre ne fait que
// rendre les lignes.
// ---------------------------------------------------------------------------

export type LiveSearchRow =
  | { kind: "all"; target: "fuel" | "chargers" | "bikes" }
  | { kind: "off"; mode: "bikes" | "fuel" }
  | { kind: "network"; network: BikeNetwork }
  | { kind: "item"; item: LiveItem; meters: number };

/** Accents, casse, apostrophes et tirets ignorés : « Vélo'v » = « velov ». */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’'`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const WORDS = {
  fuel: ["essence", "station service", "stations service", "station essence", "carburant", "carburants", "gazole", "diesel", "gasoil", "sp95", "sp98", "e10", "e85", "gpl", "plein", "pompe", "fuel", "petrol", "gas station"],
  chargers: ["borne", "bornes", "recharge", "recharger", "borne electrique", "voiture electrique", "charging", "charger", "ev"],
  bikes: ["velo", "velos", "velib", "bike", "bikes", "libre service", "bike sharing"],
};

/** La saisie désigne-t-elle ce genre de lieu ? Dès deux lettres, dans les deux sens. */
function designates(query: string, kind: keyof typeof WORDS): boolean {
  return query.length >= 2 && WORDS[kind].some((word) => word.startsWith(query) || query.startsWith(`${word} `) || query === word);
}

export interface LiveSearchContext {
  bikes: boolean;
  fuel: boolean;
  /** Le carburant est l'électrique : pas de prix à montrer, seulement des bornes. */
  electric: boolean;
  networks: BikeNetwork[];
  /** Les repères déjà sur la carte. */
  items: LiveItem[];
  near: LonLat;
}

const PER_KIND = 3;
const MAX_NETWORKS = 4;

function nearest(items: LiveItem[], near: LonLat, kind: LiveItem["kind"]) {
  return items
    .filter((item) => item.kind === kind)
    .map((item) => ({ item, meters: distance(near, item.kind === "charger" ? item.charger : item.station) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, PER_KIND);
}

export function liveSearch(raw: string, ctx: LiveSearchContext): LiveSearchRow[] {
  const query = normalize(raw);
  if (query.length < 2) return [];
  const rows: LiveSearchRow[] = [];

  if (designates(query, "fuel") && !ctx.electric) {
    if (!ctx.fuel) rows.push({ kind: "off", mode: "fuel" });
    else {
      rows.push({ kind: "all", target: "fuel" });
      for (const hit of nearest(ctx.items, ctx.near, "fuel")) rows.push({ kind: "item", ...hit });
    }
  }
  if (designates(query, "chargers") || (ctx.electric && designates(query, "fuel"))) {
    if (!ctx.fuel) rows.push({ kind: "off", mode: "fuel" });
    else {
      rows.push({ kind: "all", target: "chargers" });
      for (const hit of nearest(ctx.items, ctx.near, "charger")) rows.push({ kind: "item", ...hit });
    }
  }

  // Les réseaux par leur nom ou leur ville : « vélo'v », « bicloo », « lyon ».
  const networks =
    query.length >= 3
      ? ctx.networks.filter((n) => normalize(n.name).includes(query) || normalize(n.city).startsWith(query))
      : [];
  const local = networks.filter((n) => distance(ctx.near, n) <= 40_000);
  const far = networks.filter((n) => !local.includes(n));
  // « vélo'v » commence comme « vélo » : un réseau lointain nommé ainsi passe
  // avant les vélos d'ici, qu'il ne désigne pas.
  const named = far.length > 0 && local.length === 0 && !WORDS.bikes.includes(query);
  if ((designates(query, "bikes") && !named) || local.length > 0) {
    if (!ctx.bikes) rows.push({ kind: "off", mode: "bikes" });
    else {
      rows.push({ kind: "all", target: "bikes" });
      for (const hit of nearest(ctx.items, ctx.near, "bike")) rows.push({ kind: "item", ...hit });
    }
  }
  if (far.length > 0) {
    if (!ctx.bikes && !rows.some((r) => r.kind === "off" && r.mode === "bikes")) rows.push({ kind: "off", mode: "bikes" });
    else if (ctx.bikes) for (const network of far.slice(0, MAX_NETWORKS)) rows.push({ kind: "network", network });
  }
  return rows;
}
