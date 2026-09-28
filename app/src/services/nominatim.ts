// ---------------------------------------------------------------------------
// Le tour de parole avec Nominatim.
//
// Le service public de Nominatim n'accepte **qu'une requête par seconde**, et
// il bannit qui dépasse. Deux modules l'interrogent — le choix d'une zone hors
// ligne (`offline/boundaries.ts`) et la fiche d'une ville (`areaInfo.ts`) — :
// ils partagent donc ce tour, sans quoi chacun respecterait la règle et les
// deux ensemble la violeraient.
// ---------------------------------------------------------------------------

let nextSlot = 0;

/** Attend son tour, puis rend la main. Lève si l'appel est annulé entre-temps. */
export async function nominatimTurn(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000;
  if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
  if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
}
