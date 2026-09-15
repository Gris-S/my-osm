import type { LineChip } from "../utils/markerImage";

// ---------------------------------------------------------------------------
// Les lignes lues à un arrêt, pour les pastilles de la carte.
//
// En Île-de-France, le référentiel ouvert d'IDFM dit quelles lignes desservent
// chaque arrêt visible. Ailleurs, aucune source ne le donne sans une requête par
// arrêt : les pastilles d'un arrêt apparaissent donc **après qu'on a ouvert sa
// fiche**, avec les lignes que ses départs viennent de montrer — sans aucune
// requête de plus. Rien ne quitte la mémoire de la session.
// ---------------------------------------------------------------------------

/** Assez pour une journée de consultation ; les plus anciens partent d'abord. */
const MAX_STOPS = 500;

const stops = new Map<string, LineChip[]>();
const listeners = new Set<() => void>();

export function rememberStopLines(placeId: string, lines: LineChip[]): void {
  const chips: LineChip[] = [];
  const labels = new Set<string>();
  for (const line of lines) {
    if (labels.has(line.label)) continue;
    labels.add(line.label);
    chips.push({ label: line.label, color: line.color, textColor: line.textColor });
  }
  if (chips.length === 0) return;
  const known = stops.get(placeId);
  if (known && known.map((chip) => chip.label).join("|") === chips.map((chip) => chip.label).join("|")) return;
  stops.delete(placeId);
  stops.set(placeId, chips);
  if (stops.size > MAX_STOPS) stops.delete(stops.keys().next().value as string);
  listeners.forEach((listener) => listener());
}

export function rememberedStopLines(placeId: string): LineChip[] | undefined {
  return stops.get(placeId);
}

export function subscribeStopLines(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
